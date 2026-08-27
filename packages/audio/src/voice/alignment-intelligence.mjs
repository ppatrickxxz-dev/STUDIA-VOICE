import { confidenceDecision, normalizeConfidence } from '../contracts/confidence.mjs';

function nearestOffset(referenceEvents = [], targetEvents = []) {
  if (!referenceEvents.length || !targetEvents.length) return null;
  const ref = referenceEvents.map(event => Number(event.timeSeconds ?? event.startSeconds)).filter(Number.isFinite);
  const target = targetEvents.map(event => Number(event.timeSeconds ?? event.startSeconds)).filter(Number.isFinite);
  if (!ref.length || !target.length) return null;
  const offsets = [];
  for (const t of target) {
    let best = null;
    for (const r of ref) {
      const delta = t - r;
      if (best === null || Math.abs(delta) < Math.abs(best)) best = delta;
    }
    if (best !== null) offsets.push(best);
  }
  if (!offsets.length) return null;
  offsets.sort((a, b) => a - b);
  return offsets[Math.floor(offsets.length / 2)];
}

function confidenceFromSignals(reference, target, offsetSeconds) {
  const onsetCount = Math.min(reference?.signal?.onsets?.length || 0, target?.signal?.onsets?.length || 0);
  const onsetScore = onsetCount >= 4 ? 0.9 : onsetCount >= 2 ? 0.7 : onsetCount === 1 ? 0.5 : 0.2;
  const phaseValues = [reference?.signal?.phaseCorrelation?.value, target?.signal?.phaseCorrelation?.value]
    .map(Number)
    .filter(Number.isFinite);
  const phaseScore = phaseValues.length ? Math.max(0, Math.min(1, phaseValues.reduce((a,b)=>a+b,0) / phaseValues.length)) : 0.5;
  const offsetScore = Number.isFinite(offsetSeconds) ? Math.max(0, 1 - Math.min(Math.abs(offsetSeconds), 0.25) / 0.25) : 0;
  return normalizeConfidence(0.5 * onsetScore + 0.25 * phaseScore + 0.25 * offsetScore);
}

export function analyzeAlignment(reference, target, { maxAutoOffsetMs = 120 } = {}) {
  if (!reference?.assetId || !target?.assetId) throw new Error('reference and target analyses are required');
  const offsetSeconds = nearestOffset(reference.signal?.onsets, target.signal?.onsets);
  const confidence = confidenceFromSignals(reference, target, offsetSeconds);
  let decision = confidenceDecision(confidence);
  const offsetMs = Number.isFinite(offsetSeconds) ? offsetSeconds * 1000 : null;
  if (offsetMs !== null && Math.abs(offsetMs) > maxAutoOffsetMs && decision === 'auto') decision = 'suggest';

  return {
    referenceAssetId: reference.assetId,
    targetAssetId: target.assetId,
    offsetMs,
    correctionMs: offsetMs === null ? null : -offsetMs,
    confidence,
    decision,
    automatic: decision === 'auto',
    recommendedAction: offsetMs === null ? 'inspect' : Math.abs(offsetMs) < 1 ? 'none' : 'shift',
    polarity: 'unchanged'
  };
}
