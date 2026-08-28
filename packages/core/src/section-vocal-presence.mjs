import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';

export const PABLO_SECTION_VOCAL_PRESENCE_SOURCE = 'pablo_section_vocal_presence';
export const DEFAULT_PRESENCE_FREQUENCY_HZ = 3200;
export const DEFAULT_PRESENCE_Q = 0.9;

export function parseSectionVocalPresenceCommand(message = '') {
  const text = normalizeText(message);
  if (!text || !/\b(voz|vocal)\b/.test(text)) return null;
  const intent = /\b(mais presente|mais na frente|traz a voz pra frente|trazer a voz pra frente|coloca a voz mais na frente|colocar a voz mais na frente|mais definicao|dar definicao|da definicao|mais clareza|dar clareza|da clareza|mais articulada|mais articulado)\b/.test(text);
  if (!intent) return null;

  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  const occurrence = parseOccurrence(text);
  const explicitDb = parseExplicitDb(text);
  if (explicitDb != null && (explicitDb <= 0 || explicitDb > 3.5)) {
    return {
      section,
      label: sectionLabel(section),
      occurrence,
      blocked: true,
      reason: 'presence_out_of_safe_range',
      requestedGainDb: explicitDb,
    };
  }
  return {
    section,
    label: sectionLabel(section),
    occurrence,
    gainDb: explicitDb ?? inferredPresenceDb(text),
    frequencyHz: DEFAULT_PRESENCE_FREQUENCY_HZ,
    q: DEFAULT_PRESENCE_Q,
    blocked: false,
  };
}

export function planSectionVocalPresence(project, command) {
  if (!command || command.blocked) return { ok: false, reason: command?.reason || 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };

  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const range = timelineRangeToSourceRegion(vocal.track, sectionResult.startSeconds, sectionResult.endSeconds);
  if (!range.ok) return range;

  const gainDb = Math.round(Math.max(0.5, Math.min(3.5, Number(command.gainDb) || 1.8)) * 10) / 10;
  const frequencyHz = Math.round(Math.max(2200, Math.min(4800, Number(command.frequencyHz) || DEFAULT_PRESENCE_FREQUENCY_HZ)));
  const q = Math.round(Math.max(0.55, Math.min(1.4, Number(command.q) || DEFAULT_PRESENCE_Q)) * 100) / 100;
  const id = `${PABLO_SECTION_VOCAL_PRESENCE_SOURCE}:${vocal.track.id}:${sectionResult.section.id}`;
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
      source: PABLO_SECTION_VOCAL_PRESENCE_SOURCE,
      enabled: true,
    },
  };
}

export function applySectionVocalPresence(project, command, { now = Date.now() } = {}) {
  const plan = planSectionVocalPresence(project, command);
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

function inferredPresenceDb(text) {
  if (/\b(um pouco|pouquinho|levemente|sutilmente|sutil)\b/.test(text)) return 1;
  if (/\b(bem|bastante|bem mais|mais ainda)\b/.test(text)) return 2.8;
  return 1.8;
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
