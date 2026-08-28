import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { PABLO_SECTION_VOCAL_GAIN_SOURCE } from './section-vocal-gain.mjs';
import { PABLO_SECTION_VOCAL_SPACE_SOURCE } from './section-vocal-space.mjs';
import { PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE } from './section-vocal-brightness.mjs';
import { PABLO_SECTION_VOCAL_BODY_SOURCE } from './section-vocal-body.mjs';
import { PABLO_SECTION_VOCAL_SOFTNESS_SOURCE } from './section-vocal-softness.mjs';

export const SECTION_MIX_UNDO_MODES = Object.freeze({
  ALL: 'all',
  VOCAL_GAIN: 'vocal_gain',
  VOCAL_SPACE: 'vocal_space',
  VOCAL_BRIGHTNESS: 'vocal_brightness',
  VOCAL_BODY: 'vocal_body',
  VOCAL_SOFTNESS: 'vocal_softness',
});

export function parseSectionMixUndoCommand(message = '') {
  const text = normalizeText(message);
  if (!text || !/\b(desfaz|desfazer|remove|remover|tira|tirar|volta|voltar)\b/.test(text)) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;

  let mode = null;
  if (/\b(suavizacao|suavidade|estridencia|aspereza|menos brilho|escurecimento)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_SOFTNESS;
  else if (/\b(corpo|calor|quente|encorpada|encorpado)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_BODY;
  else if (/\b(brilho|brilhante|high shelf|highshelf)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_BRIGHTNESS;
  else if (/\b(ganho|volume)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_GAIN;
  else if (/\b(espaco|instrumental|base|beat)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_SPACE;
  else if (/\b(o que voce fez|o que o pablo fez|ajustes? do pablo|edicoes? do pablo|mudancas? do pablo)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.ALL;
  if (!mode) return null;

  return {
    section,
    label: sectionLabel(section),
    occurrence: parseOccurrence(text),
    mode,
  };
}

export function planSectionMixUndo(project, command) {
  if (!command?.section || !command?.mode) return { ok: false, reason: 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };

  const sources = sourcesForMode(command.mode);
  if (!sources.length) return { ok: false, reason: 'unsupported_mode' };
  const sectionId = sectionResult.section.id;
  const matches = [];
  for (const track of clean.tracks || []) {
    for (const event of track.regionAutomation || []) {
      if (sources.includes(event?.source) && belongsToSection(event, sectionId)) {
        matches.push({ trackId: track.id, eventId: event.id, source: event.source });
      }
    }
  }
  if (!matches.length) {
    return {
      ok: false,
      reason: 'nothing_to_undo',
      section: sectionResult.section,
      mode: command.mode,
    };
  }
  return {
    ok: true,
    project: clean,
    section: sectionResult.section,
    occurrence: command.occurrence || null,
    mode: command.mode,
    sources,
    matches,
  };
}

export function applySectionMixUndo(project, command, { now = Date.now() } = {}) {
  const plan = planSectionMixUndo(project, command);
  if (!plan.ok) return plan;
  const next = plan.project;
  const removed = [];
  for (const track of next.tracks || []) {
    const before = Array.isArray(track.regionAutomation) ? track.regionAutomation : [];
    const keep = [];
    for (const event of before) {
      if (plan.sources.includes(event?.source) && belongsToSection(event, plan.section.id)) {
        removed.push({ trackId: track.id, eventId: event.id, source: event.source });
      } else keep.push(event);
    }
    if (keep.length !== before.length) {
      track.regionAutomation = keep;
      track.updatedAt = now;
    }
  }
  next.updatedAt = now;
  return {
    ...plan,
    project: next,
    removed,
    mutated: removed.length > 0,
  };
}

export function countSectionMixEvents(project, sectionId, mode = SECTION_MIX_UNDO_MODES.ALL) {
  const sources = sourcesForMode(mode);
  let count = 0;
  for (const track of project?.tracks || []) {
    for (const event of track?.regionAutomation || []) {
      if (sources.includes(event?.source) && belongsToSection(event, sectionId)) count += 1;
    }
  }
  return count;
}

function sourcesForMode(mode) {
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_GAIN) return [PABLO_SECTION_VOCAL_GAIN_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_SPACE) return [PABLO_SECTION_VOCAL_SPACE_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_BRIGHTNESS) return [PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_BODY) return [PABLO_SECTION_VOCAL_BODY_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_SOFTNESS) return [PABLO_SECTION_VOCAL_SOFTNESS_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.ALL) return [
    PABLO_SECTION_VOCAL_GAIN_SOURCE,
    PABLO_SECTION_VOCAL_SPACE_SOURCE,
    PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE,
    PABLO_SECTION_VOCAL_BODY_SOURCE,
    PABLO_SECTION_VOCAL_SOFTNESS_SOURCE,
  ];
  return [];
}

function belongsToSection(event, sectionId) {
  const id = String(event?.id || '');
  return Boolean(sectionId) && id.endsWith(`:${sectionId}`);
}

function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
