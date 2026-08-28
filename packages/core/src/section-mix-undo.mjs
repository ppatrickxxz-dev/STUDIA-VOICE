import { migrateProject } from './project.mjs';
import { normalizeSectionKind, sectionLabel } from './section-map.mjs';
import { resolveConfirmedSectionAudition } from './section-audition.mjs';
import { PABLO_SECTION_VOCAL_GAIN_SOURCE } from './section-vocal-gain.mjs';
import { PABLO_SECTION_VOCAL_SPACE_SOURCE } from './section-vocal-space.mjs';
import { PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE } from './section-vocal-brightness.mjs';
import { PABLO_SECTION_VOCAL_BODY_SOURCE } from './section-vocal-body.mjs';
import { PABLO_SECTION_VOCAL_SOFTNESS_SOURCE } from './section-vocal-softness.mjs';
import { PABLO_SECTION_VOCAL_PRESENCE_SOURCE } from './section-vocal-presence.mjs';
import { PABLO_SECTION_VOCAL_DYNAMICS_SOURCE } from './section-vocal-dynamics.mjs';
import { PABLO_SECTION_VOCAL_DEESSER_SOURCE } from './section-vocal-deesser.mjs';
import { PABLO_SECTION_VOCAL_PLOSIVE_SOURCE } from './section-vocal-plosive.mjs';
import { PABLO_SECTION_VOCAL_CLICK_SOURCE } from './section-vocal-click.mjs';
import { PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST, PABLO_SECTION_VOCAL_CLEANUP_SOURCES } from './section-vocal-cleanup.mjs';

export const SECTION_MIX_UNDO_MODES = Object.freeze({
  ALL: 'all',
  VOCAL_GAIN: 'vocal_gain',
  VOCAL_SPACE: 'vocal_space',
  VOCAL_BRIGHTNESS: 'vocal_brightness',
  VOCAL_BODY: 'vocal_body',
  VOCAL_SOFTNESS: 'vocal_softness',
  VOCAL_PRESENCE: 'vocal_presence',
  VOCAL_DYNAMICS: 'vocal_dynamics',
  VOCAL_DEESSER: 'vocal_deesser',
  VOCAL_PLOSIVE: 'vocal_plosive',
  VOCAL_CLICK: 'vocal_click',
  VOCAL_DENOISE: 'vocal_denoise',
  VOCAL_DEREVERB: 'vocal_dereverb',
  VOCAL_CLEANUP: 'vocal_cleanup',
});

export function parseSectionMixUndoCommand(message = '') {
  const text = normalizeText(message);
  if (!text || !/\b(desfaz|desfazer|remove|remover|tira|tirar|volta|voltar)\b/.test(text)) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  let mode = null;
  if (/\b(limpeza|cleanup|limpa(?:r)? a voz|limpa(?:r)? minha voz)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_CLEANUP;
  else if (/\b(denoise|ruido de fundo|reducao de ruido)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_DENOISE;
  else if (/\b(de reverb|dereverb|reverberacao|reverb|reflexos? do ambiente)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_DEREVERB;
  else if (/\b(estalo|estalos|estalido|estalidos|click|clicks|clique|cliques|clicks de boca|cliques de boca|estalos de boca)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_CLICK;
  else if (/\b(plosiva|plosivas|p e b|pes e bes|estouros? de p|estouros? de b|pop do microfone|pops do microfone|popping vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_PLOSIVE;
  else if (/\b(de esser|deesser|sibilancia|sibilancias|sibilante|sibilantes|esses|chiado do s|chiado dos esses)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_DEESSER;
  else if (/\b(dinamica|compressao|compressor|picos?)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_DYNAMICS;
  else if (/\b(presenca|presente|na frente|definicao|clareza|articulacao)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_PRESENCE;
  else if (/\b(suavizacao|suavidade|estridencia|aspereza|menos brilho|escurecimento)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_SOFTNESS;
  else if (/\b(corpo|calor|quente|encorpada|encorpado)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_BODY;
  else if (/\b(brilho|brilhante|high shelf|highshelf)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_BRIGHTNESS;
  else if (/\b(ganho|volume)\b/.test(text) && /\b(voz|vocal)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_GAIN;
  else if (/\b(espaco|instrumental|base|beat)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.VOCAL_SPACE;
  else if (/\b(o que voce fez|o que o pablo fez|ajustes? do pablo|edicoes? do pablo|mudancas? do pablo)\b/.test(text)) mode = SECTION_MIX_UNDO_MODES.ALL;
  if (!mode) return null;
  return { section, label: sectionLabel(section), occurrence: parseOccurrence(text), mode };
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
  for (const track of clean.tracks || []) for (const event of track.regionAutomation || []) if (sources.includes(event?.source) && belongsToSection(event, sectionId)) matches.push({ trackId: track.id, eventId: event.id, source: event.source });
  if (!matches.length) return { ok: false, reason: 'nothing_to_undo', section: sectionResult.section, mode: command.mode };
  return { ok: true, project: clean, section: sectionResult.section, occurrence: command.occurrence || null, mode: command.mode, sources, matches };
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
      if (plan.sources.includes(event?.source) && belongsToSection(event, plan.section.id)) removed.push({ trackId: track.id, eventId: event.id, source: event.source });
      else keep.push(event);
    }
    if (keep.length !== before.length) { track.regionAutomation = keep; track.updatedAt = now; }
  }
  next.updatedAt = now;
  return { ...plan, project: next, removed, mutated: removed.length > 0 };
}

export function countSectionMixEvents(project, sectionId, mode = SECTION_MIX_UNDO_MODES.ALL) {
  const sources = sourcesForMode(mode);
  let count = 0;
  for (const track of project?.tracks || []) for (const event of track?.regionAutomation || []) if (sources.includes(event?.source) && belongsToSection(event, sectionId)) count += 1;
  return count;
}

export function sourcesForSectionMixUndoMode(mode) {
  return sourcesForMode(mode);
}

function sourcesForMode(mode) {
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_GAIN) return [PABLO_SECTION_VOCAL_GAIN_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_SPACE) return [PABLO_SECTION_VOCAL_SPACE_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_BRIGHTNESS) return [PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_BODY) return [PABLO_SECTION_VOCAL_BODY_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_SOFTNESS) return [PABLO_SECTION_VOCAL_SOFTNESS_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_PRESENCE) return [PABLO_SECTION_VOCAL_PRESENCE_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_DYNAMICS) return [PABLO_SECTION_VOCAL_DYNAMICS_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_DEESSER) return [PABLO_SECTION_VOCAL_DEESSER_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_PLOSIVE) return [PABLO_SECTION_VOCAL_PLOSIVE_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_CLICK) return [PABLO_SECTION_VOCAL_CLICK_SOURCE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_DENOISE) return [PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_DEREVERB) return [PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB];
  if (mode === SECTION_MIX_UNDO_MODES.VOCAL_CLEANUP) return [...PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST];
  if (mode === SECTION_MIX_UNDO_MODES.ALL) return [PABLO_SECTION_VOCAL_GAIN_SOURCE, PABLO_SECTION_VOCAL_SPACE_SOURCE, PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE, PABLO_SECTION_VOCAL_BODY_SOURCE, PABLO_SECTION_VOCAL_SOFTNESS_SOURCE, PABLO_SECTION_VOCAL_PRESENCE_SOURCE, PABLO_SECTION_VOCAL_DYNAMICS_SOURCE, PABLO_SECTION_VOCAL_DEESSER_SOURCE, PABLO_SECTION_VOCAL_PLOSIVE_SOURCE, PABLO_SECTION_VOCAL_CLICK_SOURCE, ...PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST];
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
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
