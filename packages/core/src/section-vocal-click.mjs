import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';

export const PABLO_SECTION_VOCAL_CLICK_SOURCE = 'pablo_section_vocal_click';
export const DEFAULT_CLICK = Object.freeze({
  maxReductionDb: 5,
  minReductionDb: 2,
  confidenceThreshold: 0.68,
  intensityThreshold: 0.2,
  differenceRatioThreshold: 0.45,
  maxLowFrequencyRatio: 0.58,
  maxDurationSeconds: 0.05,
  preRollSeconds: 0.003,
  postRollSeconds: 0.008,
  mergeGapSeconds: 0.006,
});

export function parseSectionVocalClickCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(desfaz|desfazer|volta|voltar)\b/.test(text)) return null;
  const intent = /\b(estalo|estalos|estalido|estalidos|click|clicks|clique|cliques|clicks de boca|cliques de boca|estalos de boca|estalidos de boca|barulhinho de boca|barulhinhos de boca|mouth click|mouth clicks)\b/.test(text);
  if (!intent || !/\b(voz|vocal|boca|microfone|mic)\b/.test(text)) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  const occurrence = parseOccurrence(text);
  const explicitDb = parseExplicitDb(text);
  if (explicitDb != null && (explicitDb < 0.5 || explicitDb > 7)) {
    return { section, label: sectionLabel(section), occurrence, blocked: true, reason: 'click_out_of_safe_range', requestedReductionDb: explicitDb };
  }
  return {
    section,
    label: sectionLabel(section),
    occurrence,
    maxReductionDb: explicitDb ?? inferredReductionDb(text),
    blocked: false,
  };
}

export function resolveSectionVocalClickTarget(project, command) {
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

export function planSectionVocalClick(project, command, { clickEvents = null, analysisSource = null } = {}) {
  const target = resolveSectionVocalClickTarget(project, command);
  if (!target.ok) return target;
  if (!Array.isArray(clickEvents)) return { ...target, ok: false, reason: 'click_analysis_required' };
  const maxReductionDb = roundTenth(clamp(Number(command.maxReductionDb) || DEFAULT_CLICK.maxReductionDb, 0.5, 7));
  const candidates = clickEvents
    .map((event, index) => normalizeClickCandidate(event, index, target.range, maxReductionDb))
    .filter(Boolean)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const windows = mergeCandidateWindows(candidates, target.range);
  if (!windows.length) {
    return { ...target, ok: false, reason: 'no_click_evidence', analyzedEventCount: clickEvents.length, analysisSource: String(analysisSource || 'unknown') };
  }
  const events = windows.map((window, index) => ({
    id: `${PABLO_SECTION_VOCAL_CLICK_SOURCE}:${target.track.id}:${index + 1}:${target.section.id}`,
    kind: 'gain',
    startSeconds: roundMillis(window.startSeconds),
    endSeconds: roundMillis(window.endSeconds),
    gainDb: -roundTenth(window.reductionDb),
    confidence: roundHundredth(window.confidence),
    source: PABLO_SECTION_VOCAL_CLICK_SOURCE,
    enabled: true,
  }));
  return {
    ...target,
    ok: true,
    maxReductionDb,
    events,
    detectedCount: events.length,
    analyzedEventCount: clickEvents.length,
    analysisSource: String(analysisSource || 'unknown'),
  };
}

export function applySectionVocalClick(project, command, options = {}) {
  const plan = planSectionVocalClick(project, command, options);
  if (!plan.ok) return plan;
  const next = plan.project;
  const track = next.tracks.find((candidate) => candidate.id === plan.track.id);
  if (!track) return { ok: false, reason: 'vocal_track_missing' };
  const prior = Array.isArray(track.regionAutomation) ? track.regionAutomation : [];
  const removed = prior.filter((event) => isOwnedSectionClickEvent(event, plan.section.id));
  track.regionAutomation = [...prior.filter((event) => !isOwnedSectionClickEvent(event, plan.section.id)), ...plan.events];
  const now = Number(options.now) || Date.now();
  track.updatedAt = now;
  next.updatedAt = now;
  return { ...plan, project: next, track, mutated: true, replacedExisting: removed.length > 0, replacedCount: removed.length };
}

export function isOwnedSectionClickEvent(event, sectionId) {
  return event?.source === PABLO_SECTION_VOCAL_CLICK_SOURCE && Boolean(sectionId) && String(event?.id || '').endsWith(`:${sectionId}`);
}

function normalizeClickCandidate(event, index, range, maxReductionDb) {
  const start = Number(event?.start ?? event?.time);
  const rawEnd = Number(event?.end ?? event?.time);
  const confidence = clamp(Number(event?.confidence) || 0, 0, 1);
  const intensity = clamp(Number(event?.intensity) || 0, 0, 1);
  const differenceRatio = Number(event?.differenceRatio);
  const lowFrequencyRatio = Number(event?.lowFrequencyRatio);
  if (!Number.isFinite(start) || !Number.isFinite(rawEnd) || rawEnd <= start) return null;
  if (rawEnd - start > DEFAULT_CLICK.maxDurationSeconds) return null;
  if (confidence < DEFAULT_CLICK.confidenceThreshold || intensity < DEFAULT_CLICK.intensityThreshold) return null;
  if (!Number.isFinite(differenceRatio) || differenceRatio < DEFAULT_CLICK.differenceRatioThreshold) return null;
  if (!Number.isFinite(lowFrequencyRatio) || lowFrequencyRatio > DEFAULT_CLICK.maxLowFrequencyRatio) return null;
  const overlapStart = Math.max(start, range.startSeconds);
  const overlapEnd = Math.min(rawEnd, range.endSeconds);
  if (!(overlapEnd > overlapStart)) return null;
  const confidenceDrive = clamp((confidence - DEFAULT_CLICK.confidenceThreshold) / (1 - DEFAULT_CLICK.confidenceThreshold), 0, 1);
  const impulseDrive = clamp((differenceRatio - DEFAULT_CLICK.differenceRatioThreshold) / 1.2, 0, 1);
  const severity = clamp(0.5 * confidenceDrive + 0.3 * intensity + 0.2 * impulseDrive, 0, 1);
  const reductionDb = clamp(DEFAULT_CLICK.minReductionDb + severity * (maxReductionDb - DEFAULT_CLICK.minReductionDb), DEFAULT_CLICK.minReductionDb, maxReductionDb);
  return {
    index,
    startSeconds: Math.max(range.startSeconds, overlapStart - DEFAULT_CLICK.preRollSeconds),
    endSeconds: Math.min(range.endSeconds, overlapEnd + DEFAULT_CLICK.postRollSeconds),
    reductionDb,
    confidence,
  };
}

function mergeCandidateWindows(candidates, range) {
  const merged = [];
  for (const candidate of candidates) {
    const current = merged.at(-1);
    if (current && candidate.startSeconds - current.endSeconds <= DEFAULT_CLICK.mergeGapSeconds) {
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
  if (/\b(um pouco|pouquinho|leve|levemente|sutil|sutilmente)\b/.test(text)) return 3;
  if (/\b(bem|bastante|mais forte|mais firme)\b/.test(text)) return 6;
  return DEFAULT_CLICK.maxReductionDb;
}
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function roundMillis(value) { return Math.round(Number(value) * 1000) / 1000; }
function roundTenth(value) { return Math.round(Number(value) * 10) / 10; }
function roundHundredth(value) { return Math.round(Number(value) * 100) / 100; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
