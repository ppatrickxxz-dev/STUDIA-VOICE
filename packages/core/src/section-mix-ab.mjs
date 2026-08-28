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
import { PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST } from './section-vocal-cleanup.mjs';

export const PABLO_SECTION_MIX_SOURCES = Object.freeze([
  PABLO_SECTION_VOCAL_GAIN_SOURCE,
  PABLO_SECTION_VOCAL_SPACE_SOURCE,
  PABLO_SECTION_VOCAL_BRIGHTNESS_SOURCE,
  PABLO_SECTION_VOCAL_BODY_SOURCE,
  PABLO_SECTION_VOCAL_SOFTNESS_SOURCE,
  PABLO_SECTION_VOCAL_PRESENCE_SOURCE,
  PABLO_SECTION_VOCAL_DYNAMICS_SOURCE,
  PABLO_SECTION_VOCAL_DEESSER_SOURCE,
  PABLO_SECTION_VOCAL_PLOSIVE_SOURCE,
  PABLO_SECTION_VOCAL_CLICK_SOURCE,
  ...PABLO_SECTION_VOCAL_CLEANUP_SOURCE_LIST,
]);

export function parseSectionMixABCommand(message = '') {
  const text = normalizeText(message);
  if (!text) return null;
  const wantsComparison = /\b(compara|comparar|compare|ab|a b|antes e depois|sem e com|com e sem)\b/.test(text);
  if (!wantsComparison) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = normalizeSectionKind(sectionMatch?.[1] || '');
  if (!section) return null;
  return { section, label: sectionLabel(section), occurrence: parseOccurrence(text) };
}

export function planSectionMixAB(project, command) {
  if (!command?.section) return { ok: false, reason: 'unsupported_command' };
  const clean = migrateProject(project);
  const sectionResult = resolveConfirmedSectionAudition(clean.arrangementMap, command.section, { occurrence: command.occurrence });
  if (!sectionResult.ok) return { ok: false, reason: sectionResult.reason, sectionResult };
  const matches = findPabloSectionMixEvents(clean, sectionResult.section.id);
  if (!matches.length) return { ok: false, reason: 'nothing_to_compare', project: clean, section: sectionResult.section };
  return { ok: true, project: clean, section: sectionResult.section, occurrence: command.occurrence || null, matches };
}

export function buildSectionMixABVariant(project, sectionId, variant = 'B') {
  const clean = migrateProject(project);
  const normalizedVariant = String(variant || 'B').toUpperCase();
  if (!['A', 'B'].includes(normalizedVariant)) throw new TypeError('Variante A/B inválida.');
  if (normalizedVariant === 'B') return { project: clean, variant: 'B', removed: [] };
  const removed = [];
  for (const track of clean.tracks || []) {
    const before = Array.isArray(track.regionAutomation) ? track.regionAutomation : [];
    const keep = [];
    for (const event of before) {
      if (isPabloSectionMixEvent(event, sectionId)) removed.push({ trackId: track.id, eventId: event.id, source: event.source });
      else keep.push(event);
    }
    track.regionAutomation = keep;
  }
  return { project: clean, variant: 'A', removed };
}

export function findPabloSectionMixEvents(project, sectionId) {
  const matches = [];
  for (const track of project?.tracks || []) for (const event of track?.regionAutomation || []) if (isPabloSectionMixEvent(event, sectionId)) matches.push({ trackId: track.id, eventId: event.id, source: event.source });
  return matches;
}

export function isPabloSectionMixEvent(event, sectionId) {
  const source = String(event?.source || '');
  const id = String(event?.id || '');
  return Boolean(sectionId) && PABLO_SECTION_MIX_SOURCES.includes(source) && id.endsWith(`:${sectionId}`);
}

function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}

function normalizeText(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}
