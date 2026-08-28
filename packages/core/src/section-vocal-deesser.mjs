import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';

export const PABLO_SECTION_VOCAL_DEESSER_SOURCE = 'pablo_section_vocal_deesser';
export const DEFAULT_DEESSER = Object.freeze({
  frequencyHz: 7200,
  minFrequencyHz: 4800,
  maxFrequencyHz: 10800,
  spectralConfidenceThreshold: 0.12,
  q: 1.5,
  maxReductionDb: 3.2,
  minReductionDb: 1.2,
  confidenceThreshold: 0.62,
  intensityThreshold: 0.15,
  preRollSeconds: 0.012,
  postRollSeconds: 0.025,
  mergeGapSeconds: 0.018,
});

export function parseSectionVocalDeEsserCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(desfaz|desfazer|volta|voltar)\b/.test(text)) return null;
  const intent = /\b(de esser|deesser|sibilancia|sibilancias|sibilante|sibilantes|segura os esses|segurar os esses|controla os esses|controlar os esses|reduz os esses|reduzir os esses|tira os esses|tirar os esses|chiado do s|chiado dos esses)\b/.test(text);
  if (!intent) return null;

  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;

  const occurrence = parseOccurrence(text);
  const explicitDb = parseExplicitDb(text);
  if (explicitDb != null && (explicitDb < 0.5 || explicitDb > 5)) {
    return {
      section,
      label: sectionLabel(section),
      occurrence,
      blocked: true,
      reason: 'deesser_out_of_safe_range',
      requestedReductionDb: explicitDb,
    };
  }

  return {
    section,
    label: sectionLabel(section),
    occurrence,
    maxReductionDb: explicitDb ?? inferredReductionDb(text),
    frequencyMode: 'adaptive',
    frequencyHz: DEFAULT_DEESSER.frequencyHz,
    q: DEFAULT_DEESSER.q,
    blocked: false,
  };
}

export function resolveSectionVocalDeEsserTarget(project, command) {
  if (!command || command.blocked) return { ok: false, reason: command?.reason || 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };

  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const range = timelineRangeToSourceRegion(vocal.track, sectionResult.startSeconds, sectionResult.endSeconds);
  if (!range.ok) return range;

  return {
    ok: true,
    project: clean,
    track: vocal.track,
    section: sectionResult.section,
    occurrence: command.occurrence || null,
    range,
  };
}

export function planSectionVocalDeEsser(project, command, {
  sibilanceEvents = null,
  analysisSource = null,
  adaptiveFrequencyRequired = false,
} = {}) {
  const target = resolveSectionVocalDeEsserTarget(project, command);
  if (!target.ok) return target;
  if (!Array.isArray(sibilanceEvents)) {
    return { ...target, ok: false, reason: 'sibilance_analysis_required' };
  }

  const maxReductionDb = roundTenth(clamp(Number(command.maxReductionDb) || DEFAULT_DEESSER.maxReductionDb, 0.5, 5));
  const fallbackFrequencyHz = Math.round(clamp(Number(command.frequencyHz) || DEFAULT_DEESSER.frequencyHz, DEFAULT_DEESSER.minFrequencyHz, DEFAULT_DEESSER.maxFrequencyHz));
  const q = roundHundredth(clamp(Number(command.q) || DEFAULT_DEESSER.q, 0.8, 3));
  const acousticCandidates = sibilanceEvents
    .map((event, index) => normalizeSibilanceCandidate(event, index, target.range, maxReductionDb, {
      fallbackFrequencyHz,
      adaptiveFrequencyRequired,
    }))
    .filter(Boolean)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const candidates = acousticCandidates.filter((candidate) => Number.isFinite(candidate.frequencyHz));

  if (!candidates.length) {
    const missingAdaptiveBand = adaptiveFrequencyRequired && acousticCandidates.some((candidate) => candidate.missingAdaptiveBand);
    return {
      ...target,
      ok: false,
      reason: missingAdaptiveBand ? 'adaptive_sibilance_band_required' : 'no_sibilance_evidence',
      analyzedEventCount: sibilanceEvents.length,
      analysisSource: String(analysisSource || 'unknown'),
    };
  }

  const windows = mergeCandidateWindows(candidates, target.range);
  const events = windows.map((window, index) => ({
    id: `${PABLO_SECTION_VOCAL_DEESSER_SOURCE}:${target.track.id}:${index + 1}:${target.section.id}`,
    kind: 'peaking_eq',
    startSeconds: roundMillis(window.startSeconds),
    endSeconds: roundMillis(window.endSeconds),
    gainDb: -roundTenth(window.reductionDb),
    frequencyHz: roundTo(window.frequencyHz, 50),
    q,
    confidence: roundHundredth(window.confidence),
    source: PABLO_SECTION_VOCAL_DEESSER_SOURCE,
    enabled: true,
  }));
  const frequencies = events.map((event) => event.frequencyHz);
  const frequencyRangeHz = [Math.min(...frequencies), Math.max(...frequencies)];
  const frequencyHz = roundTo(frequencies.reduce((sum, value) => sum + value, 0) / frequencies.length, 50);

  return {
    ...target,
    ok: true,
    maxReductionDb,
    frequencyHz,
    frequencyRangeHz,
    frequencyMode: windows.every((window) => window.adaptiveBand) ? 'adaptive' : 'legacy-fallback',
    q,
    events,
    detectedCount: events.length,
    analyzedEventCount: sibilanceEvents.length,
    analysisSource: String(analysisSource || 'unknown'),
  };
}

export function applySectionVocalDeEsser(project, command, options = {}) {
  const plan = planSectionVocalDeEsser(project, command, options);
  if (!plan.ok) return plan;
  const next = plan.project;
  const track = next.tracks.find((candidate) => candidate.id === plan.track.id);
  if (!track) return { ok: false, reason: 'vocal_track_missing' };

  const prior = Array.isArray(track.regionAutomation) ? track.regionAutomation : [];
  const removed = prior.filter((event) => isOwnedSectionDeEsserEvent(event, plan.section.id));
  track.regionAutomation = [
    ...prior.filter((event) => !isOwnedSectionDeEsserEvent(event, plan.section.id)),
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

export function isOwnedSectionDeEsserEvent(event, sectionId) {
  return event?.source === PABLO_SECTION_VOCAL_DEESSER_SOURCE
    && Boolean(sectionId)
    && String(event?.id || '').endsWith(`:${sectionId}`);
}

function normalizeSibilanceCandidate(event, index, range, maxReductionDb, {
  fallbackFrequencyHz,
  adaptiveFrequencyRequired,
}) {
  const start = Number(event?.start ?? event?.time);
  const rawEnd = Number(event?.end ?? event?.time);
  const confidence = clamp(Number(event?.confidence) || 0, 0, 1);
  const intensity = clamp(Number(event?.intensity) || 0, 0, 1);
  if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || rawEnd <= start) return null;
  if (confidence < DEFAULT_DEESSER.confidenceThreshold || intensity < DEFAULT_DEESSER.intensityThreshold) return null;
  const overlapStart = Math.max(start, range.startSeconds);
  const overlapEnd = Math.min(rawEnd, range.endSeconds);
  if (!(overlapEnd > overlapStart)) return null;

  const confidenceDrive = clamp((confidence - DEFAULT_DEESSER.confidenceThreshold) / (1 - DEFAULT_DEESSER.confidenceThreshold), 0, 1);
  const severity = clamp(0.55 * confidenceDrive + 0.45 * intensity, 0, 1);
  const reductionDb = clamp(
    DEFAULT_DEESSER.minReductionDb + severity * (maxReductionDb - DEFAULT_DEESSER.minReductionDb),
    DEFAULT_DEESSER.minReductionDb,
    maxReductionDb,
  );

  const measuredFrequency = Number(event?.frequencyHz);
  const spectralConfidence = clamp(Number(event?.spectralConfidence) || 0, 0, 1);
  const hasAdaptiveBand = Number.isFinite(measuredFrequency)
    && measuredFrequency >= DEFAULT_DEESSER.minFrequencyHz
    && measuredFrequency <= DEFAULT_DEESSER.maxFrequencyHz
    && spectralConfidence >= DEFAULT_DEESSER.spectralConfidenceThreshold;
  const frequencyHz = hasAdaptiveBand
    ? clamp(measuredFrequency, DEFAULT_DEESSER.minFrequencyHz, DEFAULT_DEESSER.maxFrequencyHz)
    : (adaptiveFrequencyRequired ? null : fallbackFrequencyHz);
  const frequencyWeight = Math.max(0.05, spectralConfidence) * Math.max(0.15, intensity) * Math.max(0.5, reductionDb);

  return {
    index,
    startSeconds: Math.max(range.startSeconds, overlapStart - DEFAULT_DEESSER.preRollSeconds),
    endSeconds: Math.min(range.endSeconds, overlapEnd + DEFAULT_DEESSER.postRollSeconds),
    reductionDb,
    confidence,
    frequencyHz,
    frequencyWeight,
    adaptiveBand: hasAdaptiveBand,
    missingAdaptiveBand: adaptiveFrequencyRequired && !hasAdaptiveBand,
  };
}

function mergeCandidateWindows(candidates, range) {
  const merged = [];
  for (const candidate of candidates) {
    const current = merged.at(-1);
    if (current && candidate.startSeconds - current.endSeconds <= DEFAULT_DEESSER.mergeGapSeconds) {
      const combinedWeight = current.frequencyWeight + candidate.frequencyWeight;
      current.frequencyHz = combinedWeight > 0
        ? ((current.frequencyHz * current.frequencyWeight) + (candidate.frequencyHz * candidate.frequencyWeight)) / combinedWeight
        : current.frequencyHz;
      current.frequencyWeight = combinedWeight;
      current.endSeconds = Math.min(range.endSeconds, Math.max(current.endSeconds, candidate.endSeconds));
      current.reductionDb = Math.max(current.reductionDb, candidate.reductionDb);
      current.confidence = Math.max(current.confidence, candidate.confidence);
      current.adaptiveBand = current.adaptiveBand && candidate.adaptiveBand;
    } else {
      merged.push({ ...candidate });
    }
  }
  return merged.filter((window) => window.endSeconds > window.startSeconds);
}

function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}

function parseExplicitDb(text) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*d\s*b\b/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

function inferredReductionDb(text) {
  if (/\b(um pouco|pouquinho|leve|levemente|sutil|sutilmente)\b/.test(text)) return 2;
  if (/\b(bem|bastante|mais forte|mais firme)\b/.test(text)) return 4;
  return DEFAULT_DEESSER.maxReductionDb;
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[/_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function roundMillis(value) { return Math.round(Number(value) * 1000) / 1000; }
function roundTenth(value) { return Math.round(Number(value) * 10) / 10; }
function roundHundredth(value) { return Math.round(Number(value) * 100) / 100; }
function roundTo(value, step) { return Math.round(Number(value) / step) * step; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
