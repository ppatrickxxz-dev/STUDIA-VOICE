import { normalizeSectionKind, sectionLabel } from './section-map.mjs';

const SECTION_HERE_PATTERN = /\b(?:marca|marque|marcar|comeca|começa|inicia|iniciar)\s+(?:o|a)?\s*(pr[eé][- ]?refr[aã]o|refr[aã]o|verso|ponte|intro|rap|outro)\s+(?:comeca\s+|começa\s+)?aqui\b|\b(?:o|a)\s+(pr[eé][- ]?refr[aã]o|refr[aã]o|verso|ponte|intro|rap|outro)\s+(?:comeca|começa|inicia)\s+aqui\b/i;

export function parseSectionHereCommand(message = '') {
  const text = String(message || '').trim();
  if (!text || /^\s*\[[^\]]+\]/.test(text)) return null;
  const match = text.match(SECTION_HERE_PATTERN);
  const rawSection = match?.[1] || match?.[2] || '';
  const section = normalizeSectionKind(rawSection);
  return section ? { section, label: sectionLabel(section) } : null;
}
