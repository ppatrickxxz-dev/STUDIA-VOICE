import { normalizeSectionKind, sectionLabel } from './section-map.mjs';

const SECTION_TOKEN = '(pr[eé][- ]?refr[aã]o|refr[aã]o|verso|ponte|intro|rap|outro)';
const SECTION_HERE_PATTERN = new RegExp(`\\b(?:marca|marque|marcar|comeca|começa|inicia|iniciar)\\s+(?:o|a)?\\s*${SECTION_TOKEN}\\s+(?:comeca\\s+|começa\\s+)?aqui\\b|\\b(?:o|a)\\s+${SECTION_TOKEN}\\s+(?:comeca|começa|inicia)\\s+aqui\\b`, 'i');
const SECTION_END_HERE_PATTERN = new RegExp(`\\b(?:o|a)?\\s*${SECTION_TOKEN}\\s+(?:termina|acaba|encerra)\\s+aqui\\b|\\b(?:termina|encerra)\\s+(?:o|a)?\\s*${SECTION_TOKEN}\\s+aqui\\b|\\b(?:marca|marque|marcar)\\s+(?:o\\s+)?fim\\s+(?:do|da)\\s+${SECTION_TOKEN}\\s+aqui\\b`, 'i');

export function parseSectionHereCommand(message = '') {
  return parseWithPattern(message, SECTION_HERE_PATTERN);
}

export function parseSectionEndHereCommand(message = '') {
  return parseWithPattern(message, SECTION_END_HERE_PATTERN);
}

function parseWithPattern(message, pattern) {
  const text = String(message || '').trim();
  if (!text || /^\s*\[[^\]]+\]/.test(text)) return null;
  const match = text.match(pattern);
  const rawSection = match?.slice(1).find(Boolean) || '';
  const section = normalizeSectionKind(rawSection);
  return section ? { section, label: sectionLabel(section) } : null;
}
