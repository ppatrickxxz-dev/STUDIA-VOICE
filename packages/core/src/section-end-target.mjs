import { normalizeArrangementMap, normalizeSectionKind } from './section-map.mjs';

export function resolveSectionEndTarget(map, kind, endSeconds) {
  const normalizedKind = normalizeSectionKind(kind);
  const end = Number(endSeconds);
  if (!normalizedKind || !Number.isFinite(end) || end <= 0) {
    return { ok: false, reason: 'invalid_end' };
  }

  const sections = normalizeArrangementMap(map).sections;
  const candidates = sections
    .filter((section) => section.kind === normalizedKind
      && section.timingStatus === 'confirmed'
      && section.confidence >= 0.8
      && Number.isFinite(section.startSeconds)
      && section.startSeconds < end)
    .sort((a, b) => b.startSeconds - a.startSeconds);
  const target = candidates[0] || null;
  if (!target) return { ok: false, reason: 'missing_confirmed_start' };

  const blocker = sections.find((section) =>
    section.id !== target.id
    && section.timingStatus === 'confirmed'
    && section.confidence >= 0.8
    && section.startSeconds > target.startSeconds
    && section.startSeconds < end);
  if (blocker) {
    return {
      ok: false,
      reason: 'crosses_confirmed_section',
      target,
      blocker,
    };
  }

  return {
    ok: true,
    target,
    endSeconds: Math.round(end * 1000) / 1000,
  };
}
