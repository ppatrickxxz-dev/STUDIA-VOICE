import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';

export const PABLO_SECTION_VOCAL_BODY_SOURCE = 'pablo_section_vocal_body';
export const DEFAULT_BODY_FREQUENCY_HZ = 220;
export const DEFAULT_BODY_Q = 0.82;

export function parseSectionVocalBodyCommand(message = '') {
  const text = normalizeText(message);
  if (!text || !/\b(voz|vocal)\b/.test(text)) return null;
  const intent = /\b(mais corpo|dar corpo|da corpo|coloca corpo|colocar corpo|aumenta corpo|aumentar corpo|mais calor|dar calor|da calor|mais quente|aquece a voz|aquecer a voz|encorpa a voz|encorpar a voz)\b/.test(text);
  if (!intent) return null;

  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  const occurrence = parseOccurrence(text);
  const explicitDb = parseExplicitDb(text);
  if (explicitDb != null && (explicitDb <= 0 || explicitDb > 3)) {
    return {
      section,
      label: sectionLabel(section),
      occurrence,
      blocked: true,
      reason: 'body_out_of_safe_range',
      requestedGainDb: explicitDb,
    };
  }
  return {
    section,
    label: sectionLabel(section),
    occurrence,
    gainDb: explicitDb ?? inferredBodyDb(text),
    frequencyHz: DEFAULT_BODY_FREQUENCY_HZ,
    q: DEFAULT_BODY_Q,
    blocked: false,
  };
}

export function planSectionVocalBody(project, command) {
  if (!command || command.blocked) return { ok: false, reason: command?.reason || 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };

  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const range = timelineRangeToSourceRegion(vocal.track, sectionResult.startSeconds, sectionResult.endSeconds);
  if (!range.ok) return range;

  const gainDb = Math.round(Math.max(0.5, Math.min(3, Number(command.gainDb) || 1.5)) * 10) / 10;
  const frequencyHz = Math.round(Math.max(160, Math.min(360, Number(command.frequencyHz) || DEFAULT_BODY_FREQUENCY_HZ)));
  const q = Math.round(Math.max(0.55, Math.min(1.2, Number(command.q) || DEFAULT_BODY_Q)) * 100) / 100;
  const id = `${PABLO_SECTION_VOCAL_BODY_SOURCE}:${vocal.track.id}:${sectionResult.section.id}`;
  return {
    ok: true,
    project: clean,
    track: vocal.track,
    section: sectionResult.section,
    occurrence: command.occurrence || null,
    gainDb,
    frequencyHz,
    q,
    range,
    event: {
      id,
      kind: 'peaking_eq',
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      gainDb,
      frequencyHz,
      q,
      confidence: 1,
      source: PABLO_SECTION_VOCAL_BODY_SOURCE,
      enabled: true,
    },
  };
}

export function applySectionVocalBody(project, command, { now = Date.now() } = {}) {
  const plan = planSectionVocalBody(project, command);
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

function inferredBodyDb(text) {
  if (/\b(um pouco|pouquinho|levemente|sutilmente|sutil)\b/.test(text)) return 1;
  if (/\b(bem|bastante|bem mais|mais ainda)\b/.test(text)) return 2.5;
  return 1.5;
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
