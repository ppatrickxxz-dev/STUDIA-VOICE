import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';

export const PABLO_SECTION_VOCAL_GAIN_SOURCE = 'pablo_section_vocal_gain';
const VOCAL_KINDS = new Set(['recording', 'voice_variant']);

export function parseSectionVocalGainCommand(message = '') {
  const text = normalizeText(message);
  if (!text || !/\b(voz|vocal)\b/.test(text)) return null;
  if (!/\b(aumenta|aumentar|sobe|subir|levanta|levantar|mais alta|mais alto|mais volume)\b/.test(text)) return null;

  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;

  const occurrence = parseOccurrence(text);
  const explicitDb = parseExplicitDb(text);
  if (explicitDb != null && (explicitDb <= 0 || explicitDb > 4)) {
    return {
      section,
      label: sectionLabel(section),
      occurrence,
      blocked: true,
      reason: 'gain_out_of_safe_range',
      requestedGainDb: explicitDb,
    };
  }

  return {
    section,
    label: sectionLabel(section),
    occurrence,
    gainDb: explicitDb ?? inferredGainDb(text),
    blocked: false,
  };
}

export function resolveVocalTrack(project = {}) {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  const candidates = tracks.filter((track) => VOCAL_KINDS.has(String(track?.kind || '')));
  if (!candidates.length) return { ok: false, reason: 'vocal_track_missing', candidates: [] };
  if (candidates.length === 1) return { ok: true, track: candidates[0], candidates };
  const active = candidates.find((track) => track.id === project?.activeTrackId);
  if (active) return { ok: true, track: active, candidates };
  return { ok: false, reason: 'vocal_track_ambiguous', candidates };
}

export function timelineRangeToSourceRegion(track, startSeconds, endSeconds) {
  const start = Number(startSeconds);
  const end = Number(endSeconds);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { ok: false, reason: 'invalid_timeline_range' };

  const rate = 2 ** (Number(track?.effects?.pitchSemitones || 0) / 12);
  const offset = Math.max(0, Number(track?.offset || 0));
  const trimStart = Math.max(0, Number(track?.trimStart || 0));
  const rawTrimEnd = Number(track?.trimEnd ?? track?.duration ?? trimStart);
  const trimEnd = Math.max(trimStart, Number.isFinite(rawTrimEnd) ? rawTrimEnd : trimStart);
  const timelineTrackEnd = offset + Math.max(0, trimEnd - trimStart) / rate;
  const overlapStart = Math.max(start, offset);
  const overlapEnd = Math.min(end, timelineTrackEnd);
  if (!(overlapEnd > overlapStart)) return { ok: false, reason: 'section_outside_vocal_track' };

  const sourceStart = trimStart + (overlapStart - offset) * rate;
  const sourceEnd = trimStart + (overlapEnd - offset) * rate;
  return {
    ok: true,
    startSeconds: roundMillis(Math.max(trimStart, Math.min(trimEnd, sourceStart))),
    endSeconds: roundMillis(Math.max(trimStart, Math.min(trimEnd, sourceEnd))),
    timelineStartSeconds: roundMillis(overlapStart),
    timelineEndSeconds: roundMillis(overlapEnd),
    clippedToTrack: overlapStart > start + 0.0005 || overlapEnd < end - 0.0005,
  };
}

export function planSectionVocalGain(project, command) {
  if (!command || command.blocked) return { ok: false, reason: command?.reason || 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };

  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const range = timelineRangeToSourceRegion(vocal.track, sectionResult.startSeconds, sectionResult.endSeconds);
  if (!range.ok) return range;

  const gainDb = Math.round(Math.max(0.5, Math.min(4, Number(command.gainDb) || 2)) * 10) / 10;
  const id = `${PABLO_SECTION_VOCAL_GAIN_SOURCE}:${vocal.track.id}:${sectionResult.section.id}`;
  return {
    ok: true,
    project: clean,
    track: vocal.track,
    section: sectionResult.section,
    occurrence: command.occurrence || null,
    gainDb,
    range,
    event: {
      id,
      kind: 'gain',
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      gainDb,
      confidence: 1,
      source: PABLO_SECTION_VOCAL_GAIN_SOURCE,
      enabled: true,
    },
  };
}

export function applySectionVocalGain(project, command, { now = Date.now() } = {}) {
  const plan = planSectionVocalGain(project, command);
  if (!plan.ok) return plan;
  const next = plan.project;
  const track = next.tracks.find((candidate) => candidate.id === plan.track.id);
  if (!track) return { ok: false, reason: 'vocal_track_missing' };
  const prior = Array.isArray(track.regionAutomation) ? track.regionAutomation : [];
  track.regionAutomation = [
    ...prior.filter((event) => event?.id !== plan.event.id),
    plan.event,
  ];
  track.updatedAt = now;
  next.updatedAt = now;
  return {
    ...plan,
    project: next,
    track,
    mutated: true,
    replacedExisting: prior.some((event) => event?.id === plan.event.id),
  };
}

function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}

function parseExplicitDb(text) {
  const match = text.match(/(?:\+\s*)?(\d+(?:[.,]\d+)?)\s*d\s*b\b/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

function inferredGainDb(text) {
  if (/\b(um pouco|pouquinho|levemente|sutilmente)\b/.test(text)) return 1.5;
  if (/\b(bem|bastante|mais ainda|bem mais)\b/.test(text)) return 3;
  return 2;
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function roundMillis(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
