import { confidenceDecision, normalizeConfidence } from '../contracts/confidence.mjs';

const MODES = new Set(['natural', 'soften', 'remove']);

export function planBreathEdits(analysis, { mode = 'soften', minConfidence = null } = {}) {
  if (!analysis?.voice) throw new Error('voice analysis is required');
  if (!MODES.has(mode)) throw new Error(`unsupported breath mode: ${mode}`);

  const events = Array.isArray(analysis.voice.breathEvents) ? analysis.voice.breathEvents : [];
  return events.map((event, index) => {
    const confidence = normalizeConfidence(event.confidence);
    const decision = confidenceDecision(confidence);
    const effectiveDecision = Number.isFinite(minConfidence) && (confidence ?? 0) < minConfidence ? 'manual' : decision;
    const reductionDb = mode === 'natural' ? 0 : mode === 'soften' ? -6 : -18;
    return {
      id: event.id || `breath_${index}`,
      startSeconds: eventTime(event, 'start'),
      endSeconds: eventTime(event, 'end'),
      confidence,
      decision: effectiveDecision,
      action: mode,
      reductionDb,
      automatic: effectiveDecision === 'auto',
      reason: effectiveDecision === 'auto' ? null : effectiveDecision === 'suggest' ? 'review_recommended' : 'insufficient_confidence'
    };
  });
}

export function summarizeBreathPlan(plan = []) {
  return plan.reduce((summary, item) => {
    summary.total += 1;
    summary[item.decision] = (summary[item.decision] || 0) + 1;
    if (item.automatic) summary.automatic += 1;
    return summary;
  }, { total: 0, automatic: 0, auto: 0, suggest: 0, manual: 0, unknown: 0 });
}

function eventTime(event, edge) {
  const candidates = edge === 'start'
    ? [event.startSeconds, event.start, event.timeSeconds, event.time]
    : [event.endSeconds, event.end, event.timeSeconds, event.time];
  const value = candidates.map(Number).find(Number.isFinite);
  return value ?? 0;
}
