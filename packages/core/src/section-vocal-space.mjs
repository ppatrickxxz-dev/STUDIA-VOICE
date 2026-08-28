import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';

export const PABLO_SECTION_VOCAL_SPACE_SOURCE = 'pablo_section_vocal_space';
const SUPPORT_KINDS = new Set(['audio', 'beat']);

export function parseSectionVocalSpaceCommand(message = '') {
  const text = normalizeText(message);
  if (!text) return null;
  const asksSpace = /\b(abre|abrir|cria|criar|da|dar)\s+espaco\b/.test(text) && /\b(voz|vocal)\b/.test(text);
  const asksLower = /\b(abaixa|abaixar|reduz|reduzir|menos)\b/.test(text) && /\b(instrumental|beat|base)\b/.test(text);
  if (!asksSpace && !asksLower) return null;

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
      reason: 'attenuation_out_of_safe_range',
      requestedAttenuationDb: explicitDb,
    };
  }
  return {
    section,
    label: sectionLabel(section),
    occurrence,
    attenuationDb: explicitDb ?? inferredAttenuationDb(text),
    blocked: false,
  };
}

export function resolveSupportTrack(project = {}, vocalTrackId = null) {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  const candidates = tracks.filter((track) =>
    track.id !== vocalTrackId
    && SUPPORT_KINDS.has(String(track?.kind || ''))
    && track?.muted !== true);
  if (!candidates.length) return { ok: false, reason: 'support_track_missing', candidates: [] };
  if (candidates.length === 1) return { ok: true, track: candidates[0], candidates };
  return { ok: false, reason: 'support_track_ambiguous', candidates };
}

export function planSectionVocalSpace(project, command) {
  if (!command || command.blocked) return { ok: false, reason: command?.reason || 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };

  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const support = resolveSupportTrack(clean, vocal.track.id);
  if (!support.ok) return support;
  const range = timelineRangeToSourceRegion(support.track, sectionResult.startSeconds, sectionResult.endSeconds);
  if (!range.ok) return { ...range, reason: range.reason === 'section_outside_vocal_track' ? 'section_outside_support_track' : range.reason };

  const attenuationDb = Math.round(Math.max(0.5, Math.min(3, Number(command.attenuationDb) || 1.5)) * 10) / 10;
  const gainDb = -attenuationDb;
  const id = `${PABLO_SECTION_VOCAL_SPACE_SOURCE}:${support.track.id}:${sectionResult.section.id}`;
  return {
    ok: true,
    project: clean,
    vocalTrack: vocal.track,
    track: support.track,
    section: sectionResult.section,
    occurrence: command.occurrence || null,
    attenuationDb,
    gainDb,
    range,
    event: {
      id,
      kind: 'gain',
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      gainDb,
      confidence: 1,
      source: PABLO_SECTION_VOCAL_SPACE_SOURCE,
      enabled: true,
    },
  };
}

export function applySectionVocalSpace(project, command, { now = Date.now() } = {}) {
  const plan = planSectionVocalSpace(project, command);
  if (!plan.ok) return plan;
  const next = plan.project;
  const track = next.tracks.find((candidate) => candidate.id === plan.track.id);
  if (!track) return { ok: false, reason: 'support_track_missing' };
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
  const match = text.match(/(?:-|menos\s+)?(\d+(?:[.,]\d+)?)\s*d\s*b\b/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

function inferredAttenuationDb(text) {
  if (/\b(um pouco|pouquinho|levemente|sutilmente)\b/.test(text)) return 1;
  if (/\b(bem|bastante|mais espaco|bem mais)\b/.test(text)) return 2.5;
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
