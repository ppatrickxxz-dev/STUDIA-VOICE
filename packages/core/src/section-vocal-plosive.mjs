import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';

export const PABLO_SECTION_VOCAL_PLOSIVE_SOURCE = 'pablo_section_vocal_plosive';
export const DEFAULT_PLOSIVE = Object.freeze({
  q: 0.72,
  maxReductionDb: 4,
  minReductionDb: 1.5,
  confidenceThreshold: 0.64,
  intensityThreshold: 0.18,
  spectralConfidenceThreshold: 0.24,
  preRollSeconds: 0.008,
  postRollSeconds: 0.035,
  mergeGapSeconds: 0.02,
  minFrequencyHz: 80,
  maxFrequencyHz: 260,
});

export function parseSectionVocalPlosiveCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(desfaz|desfazer|volta|voltar)\b/.test(text)) return null;
  const intent = /\b(plosiva|plosivas|explosao de p|explosoes de p|explosao de b|explosoes de b|p e b|pes e bes|estouros? de p|estouros? de b|pop do microfone|pops do microfone|popping vocal|corrige os p|corrigir os p|segura os p|segurar os p)\b/.test(text);
  if (!intent) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  const occurrence = parseOccurrence(text);
  const explicitDb = parseExplicitDb(text);
  if (explicitDb != null && (explicitDb < 0.5 || explicitDb > 6)) {
    return { section, label: sectionLabel(section), occurrence, blocked: true, reason: 'plosive_out_of_safe_range', requestedReductionDb: explicitDb };
  }
  return {
    section,
    label: sectionLabel(section),
    occurrence,
    maxReductionDb: explicitDb ?? inferredReductionDb(text),
    q: DEFAULT_PLOSIVE.q,
    blocked: false,
  };
}

export function resolveSectionVocalPlosiveTarget(project, command) {
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

export function planSectionVocalPlosive(project, command, { plosiveEvents = null, analysisSource = null } = {}) {
  const target = resolveSectionVocalPlosiveTarget(project, command);
  if (!target.ok) return target;
  if (!Array.isArray(plosiveEvents)) return { ...target, ok: false, reason: 'plosive_analysis_required' };
  const maxReductionDb = roundTenth(clamp(Number(command.maxReductionDb) || DEFAULT_PLOSIVE.maxReductionDb, 0.5, 6));
  const q = roundHundredth(clamp(Number(command.q) || DEFAULT_PLOSIVE.q, 0.45, 1.4));
  const candidates = plosiveEvents
    .map((event, index) => normalizePlosiveCandidate(event, index, target.range, maxReductionDb))
    .filter(Boolean)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const windows = mergeCandidateWindows(candidates, target.range);
  if (!windows.length) {
    return { ...target, ok: false, reason: 'no_plosive_evidence', analyzedEventCount: plosiveEvents.length, analysisSource: String(analysisSource || 'unknown') };
  }
  const events = windows.map((window, index) => ({
    id: `${PABLO_SECTION_VOCAL_PLOSIVE_SOURCE}:${target.track.id}:${index + 1}:${target.section.id}`,
    kind: 'peaking_eq',
    startSeconds: roundMillis(window.startSeconds),
    endSeconds: roundMillis(window.endSeconds),
    gainDb: -roundTenth(window.reductionDb),
    frequencyHz: Math.round(window.frequencyHz),
    q,
    confidence: roundHundredth(window.confidence),
    source: PABLO_SECTION_VOCAL_PLOSIVE_SOURCE,
    enabled: true,
  }));
  return {
    ...target,
    ok: true,
    maxReductionDb,
    q,
    events,
    detectedCount: events.length,
    analyzedEventCount: plosiveEvents.length,
    analysisSource: String(analysisSource || 'unknown'),
    frequencyRangeHz: [Math.min(...events.map((event) => event.frequencyHz)), Math.max(...events.map((event) => event.frequencyHz))],
  };
}

export function applySectionVocalPlosive(project, command, options = {}) {
  const plan = planSectionVocalPlosive(project, command, options);
  if (!plan.ok) return plan;
  const next = plan.project;
  const track = next.tracks.find((candidate) => candidate.id === plan.track.id);
  if (!track) return { ok: false, reason: 'vocal_track_missing' };
  const prior = Array.isArray(track.regionAutomation) ? track.regionAutomation : [];
  const removed = prior.filter((event) => isOwnedSectionPlosiveEvent(event, plan.section.id));
  track.regionAutomation = [...prior.filter((event) => !isOwnedSectionPlosiveEvent(event, plan.section.id)), ...plan.events];
  const now = Number(options.now) || Date.now();
  track.updatedAt = now;
  next.updatedAt = now;
  return { ...plan, project: next, track, mutated: true, replacedExisting: removed.length > 0, replacedCount: removed.length };
}

export function isOwnedSectionPlosiveEvent(event, sectionId) {
  return event?.source === PABLO_SECTION_VOCAL_PLOSIVE_SOURCE && Boolean(sectionId) && String(event?.id || '').endsWith(`:${sectionId}`);
}

function normalizePlosiveCandidate(event, index, range, maxReductionDb) {
  const start = Number(event?.start ?? event?.time);
  const rawEnd = Number(event?.end ?? event?.time);
  const confidence = clamp(Number(event?.confidence) || 0, 0, 1);
  const intensity = clamp(Number(event?.intensity) || 0, 0, 1);
  const spectralConfidence = clamp(Number(event?.spectralConfidence) || 0, 0, 1);
  const frequencyHz = Number(event?.frequencyHz);
  if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || rawEnd <= start) return null;
  if (confidence < DEFAULT_PLOSIVE.confidenceThreshold || intensity < DEFAULT_PLOSIVE.intensityThreshold) return null;
  if (!Number.isFinite(frequencyHz) || frequencyHz < DEFAULT_PLOSIVE.minFrequencyHz || frequencyHz > DEFAULT_PLOSIVE.maxFrequencyHz) return null;
  if (spectralConfidence < DEFAULT_PLOSIVE.spectralConfidenceThreshold) return null;
  const overlapStart = Math.max(start, range.startSeconds);
  const overlapEnd = Math.min(rawEnd, range.endSeconds);
  if (!(overlapEnd > overlapStart)) return null;
  const confidenceDrive = clamp((confidence - DEFAULT_PLOSIVE.confidenceThreshold) / (1 - DEFAULT_PLOSIVE.confidenceThreshold), 0, 1);
  const severity = clamp(0.45 * confidenceDrive + 0.4 * intensity + 0.15 * spectralConfidence, 0, 1);
  const reductionDb = clamp(DEFAULT_PLOSIVE.minReductionDb + severity * (maxReductionDb - DEFAULT_PLOSIVE.minReductionDb), DEFAULT_PLOSIVE.minReductionDb, maxReductionDb);
  return {
    index,
    startSeconds: Math.max(range.startSeconds, overlapStart - DEFAULT_PLOSIVE.preRollSeconds),
    endSeconds: Math.min(range.endSeconds, overlapEnd + DEFAULT_PLOSIVE.postRollSeconds),
    reductionDb,
    confidence,
    frequencyHz,
    frequencyWeight: Math.max(0.05, confidence * (0.5 + 0.5 * intensity) * (0.5 + 0.5 * spectralConfidence)),
  };
}

function mergeCandidateWindows(candidates, range) {
  const merged = [];
  for (const candidate of candidates) {
    const current = merged.at(-1);
    if (current && candidate.startSeconds - current.endSeconds <= DEFAULT_PLOSIVE.mergeGapSeconds) {
      const totalWeight = current.frequencyWeight + candidate.frequencyWeight;
      current.frequencyHz = (current.frequencyHz * current.frequencyWeight + candidate.frequencyHz * candidate.frequencyWeight) / Math.max(totalWeight, 1e-9);
      current.frequencyWeight = totalWeight;
      current.endSeconds = Math.min(range.endSeconds, Math.max(current.endSeconds, candidate.endSeconds));
      current.reductionDb = Math.max(current.reductionDb, candidate.reductionDb);
      current.confidence = Math.max(current.confidence, candidate.confidence);
    } else merged.push({ ...candidate });
  }
  return merged.filter((window) => window.endSeconds > window.startSeconds);
}

function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}
function parseExplicitDb(text) { const match = text.match(/(\d+(?:[.,]\d+)?)\s*d\s*b\b/); return match ? Number(match[1].replace(',', '.')) : null; }
function inferredReductionDb(text) {
  if (/\b(um pouco|pouquinho|leve|levemente|sutil|sutilmente)\b/.test(text)) return 2.5;
  if (/\b(bem|bastante|mais forte|mais firme)\b/.test(text)) return 5;
  return DEFAULT_PLOSIVE.maxReductionDb;
}
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function roundMillis(value) { return Math.round(Number(value) * 1000) / 1000; }
function roundTenth(value) { return Math.round(Number(value) * 10) / 10; }
function roundHundredth(value) { return Math.round(Number(value) * 100) / 100; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
