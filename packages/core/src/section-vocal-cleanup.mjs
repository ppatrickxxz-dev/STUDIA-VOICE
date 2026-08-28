import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';
import { planSectionVocalDeEsser } from './section-vocal-deesser.mjs';
import { planSectionVocalPlosive } from './section-vocal-plosive.mjs';
import { planSectionVocalDynamics } from './section-vocal-dynamics.mjs';

export const PABLO_SECTION_VOCAL_CLEANUP_SOURCES = Object.freeze({
  BREATH: 'pablo_section_vocal_cleanup_breath',
  DEESSER: 'pablo_section_vocal_cleanup_deesser',
  PLOSIVE: 'pablo_section_vocal_cleanup_plosive',
  DYNAMICS: 'pablo_section_vocal_cleanup_dynamics',
});
export const PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST = Object.freeze(Object.values(PABLO_SECTION_VOCAL_CLEANUP_SOURCES));

export const DEFAULT_CLEANUP = Object.freeze({
  breathReductionDb: 5,
  breathConfidenceThreshold: 0.82,
  breathIntensityThreshold: 0.7,
  peakConfidenceThreshold: 0.66,
  peakIntensityThreshold: 0.55,
  dynamicsThresholdDb: -17,
  dynamicsRatio: 2,
  deEsserMaxReductionDb: 3,
  plosiveMaxReductionDb: 3.5,
});

export function parseSectionVocalCleanupCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(desfaz|desfazer|volta|voltar|remove|remover)\b/.test(text)) return null;
  const intent = /\b(limpa (?:a|minha) voz|limpar (?:a|minha) voz|limpeza vocal|faz uma limpeza(?: leve| levemente| sutil| sutilmente| um pouco| pouquinho)? (?:na|da) voz|fazer uma limpeza(?: leve| levemente| sutil| sutilmente| um pouco| pouquinho)? (?:na|da) voz|corrige os problemas (?:da|na) minha voz|corrigir os problemas (?:da|na) minha voz|trata (?:a|minha) voz|tratar (?:a|minha) voz)\b/.test(text);
  if (!intent) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  return {
    section,
    label: sectionLabel(section),
    occurrence: parseOccurrence(text),
    intensity: /\b(leve|levemente|sutil|sutilmente|um pouco|pouquinho)\b/.test(text) ? 'light' : 'balanced',
    blocked: false,
  };
}

export function resolveSectionVocalCleanupTarget(project, command) {
  if (!command || command.blocked) return { ok: false, reason: command?.reason || 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };
  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const range = timelineRangeToSourceRegion(vocal.track, sectionResult.startSeconds, sectionResult.endSeconds);
  if (!range.ok) return range;
  return { ok: true, project: clean, track: vocal.track, section: sectionResult.section, occurrence: command.occurrence || null, range };
}

export function planSectionVocalCleanup(project, command, { analysis = null } = {}) {
  const target = resolveSectionVocalCleanupTarget(project, command);
  if (!target.ok) return target;
  if (!analysis?.voice) return { ...target, ok: false, reason: 'cleanup_analysis_required' };
  const sectionId = target.section.id;
  const modules = { breath: null, deesser: null, plosive: null, dynamics: null };
  const events = [];

  const breathEvents = planBreathCleanup(analysis.voice.breathEvents, target.range, command.intensity, target.track.id, sectionId);
  if (breathEvents.length) {
    modules.breath = { applied: true, count: breathEvents.length };
    events.push(...breathEvents);
  } else modules.breath = { applied: false, reason: 'no_auto_breath_evidence', count: 0 };

  const deesserCommand = {
    section: command.section,
    label: command.label,
    occurrence: command.occurrence,
    maxReductionDb: command.intensity === 'light' ? 2.2 : DEFAULT_CLEANUP.deEsserMaxReductionDb,
    q: 1.5,
    blocked: false,
  };
  const deesser = planSectionVocalDeEsser(target.project, deesserCommand, {
    sibilanceEvents: analysis.voice.sibilanceEvents,
    analysisSource: analysis.voice.eventDetection?.source,
    adaptiveFrequencyRequired: true,
  });
  if (deesser.ok) {
    const adapted = deesser.events.map((event, index) => ({
      ...event,
      id: `${PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEESSER}:${target.track.id}:${index + 1}:${sectionId}`,
      source: PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEESSER,
    }));
    modules.deesser = { applied: true, count: adapted.length };
    events.push(...adapted);
  } else modules.deesser = { applied: false, reason: deesser.reason, count: 0 };

  const plosiveCommand = {
    section: command.section,
    label: command.label,
    occurrence: command.occurrence,
    maxReductionDb: command.intensity === 'light' ? 2.5 : DEFAULT_CLEANUP.plosiveMaxReductionDb,
    q: 0.72,
    blocked: false,
  };
  const plosive = planSectionVocalPlosive(target.project, plosiveCommand, {
    plosiveEvents: analysis.voice.plosiveEvents,
    analysisSource: analysis.voice.eventDetection?.source,
  });
  if (plosive.ok) {
    const adapted = plosive.events.map((event, index) => ({
      ...event,
      id: `${PABLO_SECTION_VOCAL_CLEANUP_SOURCES.PLOSIVE}:${target.track.id}:${index + 1}:${sectionId}`,
      source: PABLO_SECTION_VOCAL_CLEANUP_SOURCES.PLOSIVE,
    }));
    modules.plosive = { applied: true, count: adapted.length };
    events.push(...adapted);
  } else modules.plosive = { applied: false, reason: plosive.reason, count: 0 };

  const peakEvidence = qualifyingPeakEvents(analysis.voice.peakEvents, target.range);
  if (shouldApplyDynamics(peakEvidence)) {
    const dynamicsCommand = {
      section: command.section,
      label: command.label,
      occurrence: command.occurrence,
      thresholdDb: command.intensity === 'light' ? -15 : DEFAULT_CLEANUP.dynamicsThresholdDb,
      ratio: command.intensity === 'light' ? 1.7 : DEFAULT_CLEANUP.dynamicsRatio,
      kneeDb: 6,
      attackSeconds: 0.006,
      releaseSeconds: 0.12,
      blocked: false,
    };
    const dynamics = planSectionVocalDynamics(target.project, dynamicsCommand);
    if (dynamics.ok) {
      const adapted = {
        ...dynamics.event,
        id: `${PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DYNAMICS}:${target.track.id}:${sectionId}`,
        source: PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DYNAMICS,
        confidence: roundHundredth(Math.max(...peakEvidence.map((event) => event.confidence))),
      };
      modules.dynamics = { applied: true, count: 1, evidenceCount: peakEvidence.length };
      events.push(adapted);
    } else modules.dynamics = { applied: false, reason: dynamics.reason, count: 0, evidenceCount: peakEvidence.length };
  } else modules.dynamics = { applied: false, reason: 'no_peak_evidence', count: 0, evidenceCount: peakEvidence.length };

  if (!events.length) {
    return {
      ...target,
      ok: false,
      reason: 'no_cleanup_evidence',
      modules,
      analyzed: analysisSummary(analysis),
    };
  }
  return {
    ...target,
    ok: true,
    events,
    modules,
    analyzed: analysisSummary(analysis),
    appliedModuleCount: Object.values(modules).filter((module) => module?.applied).length,
  };
}

export function applySectionVocalCleanup(project, command, options = {}) {
  const plan = planSectionVocalCleanup(project, command, options);
  if (!plan.ok) return plan;
  const next = plan.project;
  const track = next.tracks.find((candidate) => candidate.id === plan.track.id);
  if (!track) return { ok: false, reason: 'vocal_track_missing' };
  const prior = Array.isArray(track.regionAutomation) ? track.regionAutomation : [];
  const removed = prior.filter((event) => isCleanupEventForSection(event, plan.section.id));
  track.regionAutomation = [
    ...prior.filter((event) => !isCleanupEventForSection(event, plan.section.id)),
    ...plan.events,
  ];
  const now = Number(options.now) || Date.now();
  track.updatedAt = now;
  next.updatedAt = now;
  return {
    ...plan,
    project: next,
    track,
    mutated: true,
    replacedExisting: removed.length > 0,
    replacedCount: removed.length,
  };
}

export function isCleanupEventForSection(event, sectionId) {
  return PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST.includes(String(event?.source || ''))
    && Boolean(sectionId)
    && String(event?.id || '').endsWith(`:${sectionId}`);
}

function planBreathCleanup(events, range, intensity, trackId, sectionId) {
  if (!Array.isArray(events)) return [];
  const reductionDb = intensity === 'light' ? -3.5 : -DEFAULT_CLEANUP.breathReductionDb;
  return events
    .map((event, index) => {
      const start = Number(event?.start ?? event?.time);
      const end = Number(event?.end ?? event?.time);
      const confidence = clamp(Number(event?.confidence) || 0, 0, 1);
      const breathIntensity = clamp(Number(event?.intensity) || 0, 0, 1);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
      if (confidence < DEFAULT_CLEANUP.breathConfidenceThreshold || breathIntensity < DEFAULT_CLEANUP.breathIntensityThreshold) return null;
      const boundedStart = Math.max(start, range.startSeconds);
      const boundedEnd = Math.min(end, range.endSeconds);
      if (!(boundedEnd > boundedStart)) return null;
      return {
        id: `${PABLO_SECTION_VOCAL_CLEANUP_SOURCES.BREATH}:${trackId}:${index + 1}:${sectionId}`,
        kind: 'gain',
        startSeconds: roundMillis(boundedStart),
        endSeconds: roundMillis(boundedEnd),
        gainDb: reductionDb,
        confidence: roundHundredth(confidence),
        source: PABLO_SECTION_VOCAL_CLEANUP_SOURCES.BREATH,
        enabled: true,
      };
    })
    .filter(Boolean);
}

function qualifyingPeakEvents(events, range) {
  if (!Array.isArray(events)) return [];
  return events.filter((event) => {
    const start = Number(event?.start ?? event?.time);
    const end = Number(event?.end ?? event?.time);
    const confidence = clamp(Number(event?.confidence) || 0, 0, 1);
    const intensity = clamp(Number(event?.intensity) || 0, 0, 1);
    return Number.isFinite(start) && Number.isFinite(end) && end > start
      && confidence >= DEFAULT_CLEANUP.peakConfidenceThreshold
      && intensity >= DEFAULT_CLEANUP.peakIntensityThreshold
      && Math.min(end, range.endSeconds) > Math.max(start, range.startSeconds);
  });
}

function shouldApplyDynamics(events) {
  if (events.length >= 2) return true;
  return events.some((event) => Number(event.confidence) >= 0.86 && Number(event.intensity) >= 0.85);
}

function analysisSummary(analysis) {
  const voice = analysis?.voice || {};
  return {
    breaths: Array.isArray(voice.breathEvents) ? voice.breathEvents.length : 0,
    sibilance: Array.isArray(voice.sibilanceEvents) ? voice.sibilanceEvents.length : 0,
    plosives: Array.isArray(voice.plosiveEvents) ? voice.plosiveEvents.length : 0,
    peaks: Array.isArray(voice.peakEvents) ? voice.peakEvents.length : 0,
    source: String(voice.eventDetection?.source || 'unknown'),
  };
}

function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function roundMillis(value) { return Math.round(Number(value) * 1000) / 1000; }
function roundHundredth(value) { return Math.round(Number(value) * 100) / 100; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
