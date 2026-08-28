import { normalizeArrangementMap, normalizeSectionKind, sectionLabel } from './section-map.mjs';

const SECTION_TOKEN = '(pr[eé][- ]?refr[aã]o|refr[aã]o|verso|ponte|intro|rap|outro)';
const ORDINAL_TOKEN = '(primeiro|primeira|segundo|segunda|terceiro|terceira|1|2|3)';
const AUDITION_PATTERN = new RegExp(`\\b(?:toca|toque|ouve|ouvir|escuta|escute|reproduz|reproduzir)\\s+(?:o|a)?\\s*(?:${ORDINAL_TOKEN}\\s+)?${SECTION_TOKEN}\\b`, 'i');

export function parseSectionAuditionCommand(message = '') {
  const text = String(message || '').trim();
  if (!text || /^\s*\[[^\]]+\]/.test(text)) return null;
  const match = text.match(AUDITION_PATTERN);
  if (!match) return null;
  const occurrence = normalizeOccurrence(match[1]);
  const section = normalizeSectionKind(match[2]);
  return section ? { section, label: sectionLabel(section), occurrence } : null;
}

export function resolveConfirmedSectionAudition(map, kind, { occurrence = null } = {}) {
  const normalizedKind = normalizeSectionKind(kind);
  if (!normalizedKind) return { ok: false, reason: 'invalid_section' };
  const confirmed = normalizeArrangementMap(map).sections.filter((section) =>
    section.kind === normalizedKind
    && section.timingStatus === 'confirmed'
    && section.confidence >= 0.8
    && Number.isFinite(section.startSeconds));
  if (!confirmed.length) return { ok: false, reason: 'missing_confirmed_section' };

  let target = null;
  if (occurrence != null) {
    const index = Math.max(0, Math.floor(Number(occurrence) || 1) - 1);
    target = confirmed[index] || null;
    if (!target) return { ok: false, reason: 'missing_occurrence', occurrence: index + 1, count: confirmed.length };
  } else {
    if (confirmed.length > 1) return { ok: false, reason: 'ambiguous_occurrence', count: confirmed.length };
    target = confirmed[0];
  }

  if (!Number.isFinite(target.endSeconds) || target.endSeconds <= target.startSeconds) {
    return { ok: false, reason: 'missing_confirmed_end', target };
  }
  return {
    ok: true,
    section: target,
    startSeconds: target.startSeconds,
    endSeconds: target.endSeconds,
  };
}

function normalizeOccurrence(value) {
  const key = String(value || '').toLowerCase();
  if (!key) return null;
  if (['primeiro', 'primeira', '1'].includes(key)) return 1;
  if (['segundo', 'segunda', '2'].includes(key)) return 2;
  if (['terceiro', 'terceira', '3'].includes(key)) return 3;
  return null;
}
