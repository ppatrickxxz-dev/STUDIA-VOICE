import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';

export const PABLO_SECTION_VOCAL_DYNAMICS_SOURCE = 'pablo_section_vocal_dynamics';
export const DEFAULT_DYNAMICS = Object.freeze({
  thresholdDb: -18,
  ratio: 2.2,
  kneeDb: 6,
  attackSeconds: 0.006,
  releaseSeconds: 0.12,
});

export function parseSectionVocalDynamicsCommand(message = '') {
  const text = normalizeText(message);
  if (!text || !/\b(voz|vocal|picos?)\b/.test(text)) return null;
  const intent = /\b(segura os picos|segurar os picos|segura meus picos|segurar meus picos|controla a dinamica|controlar a dinamica|comprime (?:a|minha) voz|comprimir (?:a|minha) voz|mais controlada|mais controlado|nivela (?:a|minha) voz|nivelar (?:a|minha) voz)\b/.test(text);
  if (!intent) return null;

  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  const occurrence = parseOccurrence(text);
  const explicitRatio = parseExplicitRatio(text);
  if (explicitRatio != null && (explicitRatio < 1.2 || explicitRatio > 4)) {
    return {
      section,
      label: sectionLabel(section),
      occurrence,
      blocked: true,
      reason: 'dynamics_out_of_safe_range',
      requestedRatio: explicitRatio,
    };
  }
  const intensity = inferredDynamics(text);
  return {
    section,
    label: sectionLabel(section),
    occurrence,
    thresholdDb: intensity.thresholdDb,
    ratio: explicitRatio ?? intensity.ratio,
    kneeDb: DEFAULT_DYNAMICS.kneeDb,
    attackSeconds: DEFAULT_DYNAMICS.attackSeconds,
    releaseSeconds: DEFAULT_DYNAMICS.releaseSeconds,
    blocked: false,
  };
}

export function planSectionVocalDynamics(project, command) {
  if (!command || command.blocked) return { ok: false, reason: command?.reason || 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };

  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const range = timelineRangeToSourceRegion(vocal.track, sectionResult.startSeconds, sectionResult.endSeconds);
  if (!range.ok) return range;

  const thresholdDb = Math.round(Math.max(-24, Math.min(-12, Number(command.thresholdDb) || DEFAULT_DYNAMICS.thresholdDb)) * 10) / 10;
  const ratio = Math.round(Math.max(1.2, Math.min(4, Number(command.ratio) || DEFAULT_DYNAMICS.ratio)) * 10) / 10;
  const kneeDb = Math.round(Math.max(0, Math.min(12, Number(command.kneeDb) || DEFAULT_DYNAMICS.kneeDb)) * 10) / 10;
  const attackSeconds = Math.round(Math.max(0.002, Math.min(0.03, Number(command.attackSeconds) || DEFAULT_DYNAMICS.attackSeconds)) * 1000) / 1000;
  const releaseSeconds = Math.round(Math.max(0.06, Math.min(0.3, Number(command.releaseSeconds) || DEFAULT_DYNAMICS.releaseSeconds)) * 1000) / 1000;
  const id = `${PABLO_SECTION_VOCAL_DYNAMICS_SOURCE}:${vocal.track.id}:${sectionResult.section.id}`;

  return {
    ok: true,
    project: clean,
    track: vocal.track,
    section: sectionResult.section,
    occurrence: command.occurrence || null,
    thresholdDb,
    ratio,
    kneeDb,
    attackSeconds,
    releaseSeconds,
    range,
    event: {
      id,
      kind: 'compressor',
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      thresholdDb,
      ratio,
      kneeDb,
      attackSeconds,
      releaseSeconds,
      confidence: 1,
      source: PABLO_SECTION_VOCAL_DYNAMICS_SOURCE,
      enabled: true,
    },
  };
}

export function applySectionVocalDynamics(project, command, { now = Date.now() } = {}) {
  const plan = planSectionVocalDynamics(project, command);
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

function parseExplicitRatio(text) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*:\s*1\b/);
  return match ? Number(match[1].replace(',', '.')) : null;
}

function inferredDynamics(text) {
  if (/\b(um pouco|pouquinho|leve|levemente|sutilmente|sutil)\b/.test(text)) return { thresholdDb: -15, ratio: 1.8 };
  if (/\b(bem|bastante|mais firme|mais controlada|mais controlado)\b/.test(text)) return { thresholdDb: -21, ratio: 2.8 };
  return { thresholdDb: DEFAULT_DYNAMICS.thresholdDb, ratio: DEFAULT_DYNAMICS.ratio };
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
