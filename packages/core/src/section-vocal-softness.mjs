import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { resolveVocalTrack, timelineRangeToSourceRegion } from './section-vocal-gain.mjs';

export const PABLO_SECTION_VOCAL_SOFTNESS_SOURCE = 'pablo_section_vocal_softness';
export const SOFTNESS_MODES = Object.freeze({
  DARKEN: 'darken',
  DEHARSH: 'deharsh',
});

const DEFAULTS = Object.freeze({
  [SOFTNESS_MODES.DARKEN]: Object.freeze({
    kind: 'high_shelf', gainDb: -2, frequencyHz: 6500, q: 1, maxReductionDb: 4,
  }),
  [SOFTNESS_MODES.DEHARSH]: Object.freeze({
    kind: 'peaking_eq', gainDb: -1.5, frequencyHz: 3800, q: 1.15, maxReductionDb: 3,
  }),
});

export function parseSectionVocalSoftnessCommand(message = '') {
  const text = normalizeText(message);
  if (!text || !/\b(voz|vocal)\b/.test(text)) return null;
  const mode = softnessMode(text);
  if (!mode) return null;

  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  const occurrence = parseOccurrence(text);
  const explicitDb = parseExplicitDb(text);
  const config = DEFAULTS[mode];
  if (explicitDb != null && (explicitDb <= 0 || explicitDb > config.maxReductionDb)) {
    return {
      section,
      label: sectionLabel(section),
      occurrence,
      mode,
      blocked: true,
      reason: 'softness_out_of_safe_range',
      requestedReductionDb: explicitDb,
      maxReductionDb: config.maxReductionDb,
    };
  }
  const reductionDb = explicitDb ?? inferredReductionDb(text, mode);
  return {
    section,
    label: sectionLabel(section),
    occurrence,
    mode,
    gainDb: -reductionDb,
    kind: config.kind,
    frequencyHz: config.frequencyHz,
    q: config.q,
    maxReductionDb: config.maxReductionDb,
    blocked: false,
  };
}

export function planSectionVocalSoftness(project, command) {
  if (!command || command.blocked) return { ok: false, reason: command?.reason || 'unsupported_command' };
  const config = DEFAULTS[command.mode];
  if (!config) return { ok: false, reason: 'unsupported_mode' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };

  const vocal = resolveVocalTrack(clean);
  if (!vocal.ok) return vocal;
  const range = timelineRangeToSourceRegion(vocal.track, sectionResult.startSeconds, sectionResult.endSeconds);
  if (!range.ok) return range;

  const requested = Math.abs(Number(command.gainDb) || Math.abs(config.gainDb));
  const reductionDb = Math.round(Math.max(0.5, Math.min(config.maxReductionDb, requested)) * 10) / 10;
  const gainDb = -reductionDb;
  const frequencyHz = command.mode === SOFTNESS_MODES.DARKEN
    ? Math.round(Math.max(4500, Math.min(9000, Number(command.frequencyHz) || config.frequencyHz)))
    : Math.round(Math.max(2500, Math.min(5200, Number(command.frequencyHz) || config.frequencyHz)));
  const q = Math.round(Math.max(0.5, Math.min(2, Number(command.q) || config.q)) * 100) / 100;
  const id = `${PABLO_SECTION_VOCAL_SOFTNESS_SOURCE}:${vocal.track.id}:${sectionResult.section.id}`;

  return {
    ok: true,
    project: clean,
    track: vocal.track,
    section: sectionResult.section,
    occurrence: command.occurrence || null,
    mode: command.mode,
    gainDb,
    frequencyHz,
    q,
    range,
    event: {
      id,
      kind: config.kind,
      startSeconds: range.startSeconds,
      endSeconds: range.endSeconds,
      gainDb,
      frequencyHz,
      q,
      confidence: 1,
      source: PABLO_SECTION_VOCAL_SOFTNESS_SOURCE,
      enabled: true,
    },
  };
}

export function applySectionVocalSoftness(project, command, { now = Date.now() } = {}) {
  const plan = planSectionVocalSoftness(project, command);
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

function softnessMode(text) {
  const darken = /\b(menos brilho|tirar brilho|tira brilho|reduz brilho|reduzir brilho|abaixa brilho|abaixar brilho|mais escura|mais escuro|escurece a voz|escurecer a voz)\b/.test(text);
  if (darken) return SOFTNESS_MODES.DARKEN;
  const deharsh = /\b(menos estridente|menos agressiva|menos agressivo|menos aspera|menos aspero|tira aspereza|tirar aspereza|reduz aspereza|reduzir aspereza|suaviza os agudos|suavizar os agudos|suaviza a voz|suavizar a voz)\b/.test(text);
  if (deharsh) return SOFTNESS_MODES.DEHARSH;
  return null;
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

function inferredReductionDb(text, mode) {
  if (/\b(um pouco|pouquinho|levemente|sutilmente|sutil)\b/.test(text)) return mode === SOFTNESS_MODES.DARKEN ? 1.5 : 1;
  if (/\b(bem|bastante|bem menos|muito menos)\b/.test(text)) return mode === SOFTNESS_MODES.DARKEN ? 3 : 2.5;
  return Math.abs(DEFAULTS[mode].gainDb);
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
