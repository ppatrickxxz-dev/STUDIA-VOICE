export const DEFAULT_CONFIDENCE_THRESHOLDS = Object.freeze({ suggest: 0.45, auto: 0.8 });

export function normalizeConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

export function confidenceDecision(confidence, thresholds = DEFAULT_CONFIDENCE_THRESHOLDS) {
  const c = normalizeConfidence(confidence);
  if (c === null) return 'unknown';
  if (c >= thresholds.auto) return 'auto';
  if (c >= thresholds.suggest) return 'suggest';
  return 'manual';
}
