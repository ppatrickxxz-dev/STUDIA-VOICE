export const NOTE_CORRECTION_POLICY_V1 = Object.freeze({
  minEventSeconds: 0.18,
  minConfidence: 0.72,
  deadbandCents: 12,
  maxCorrectionCents: 45,
  crossfadeSeconds: 0.035,
  preserveFormants: true,
  preserveRelativeVibrato: true,
  targetStrategy: 'explicit_or_nearest_chromatic',
});

export function planNoteCorrections({ pitchContour = [], noteEvents = [], explicitTargets = [] } = {}, policy = NOTE_CORRECTION_POLICY_V1) {
  const targets = normalizeTargets(explicitTargets);
  const corrections = [];
  const skipped = [];

  for (const event of noteEvents || []) {
    const start = Number(event?.start);
    const end = Number(event?.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const duration = end - start;
    const points = (pitchContour || []).filter((point) =>
      point?.voiced === true &&
      Number.isFinite(Number(point.midi)) &&
      Number(point.time) >= start &&
      Number(point.time) < end &&
      Number(point.confidence || 0) >= policy.minConfidence
    );
    const confidence = points.length
      ? points.reduce((sum, point) => sum + Number(point.confidence || 0), 0) / points.length
      : Number(event?.confidence || 0);

    if (duration < policy.minEventSeconds) {
      skipped.push({ start, end, reason: 'event_too_short' });
      continue;
    }
    if (!points.length || confidence < policy.minConfidence) {
      skipped.push({ start, end, reason: 'low_confidence' });
      continue;
    }

    const medianMidi = median(points.map((point) => Number(point.midi)));
    const explicit = targets.find((target) => overlaps(start, end, target.start, target.end));
    const targetMidi = explicit ? explicit.targetMidi : Math.round(medianMidi);
    const correctionCents = (targetMidi - medianMidi) * 100;
    const absCents = Math.abs(correctionCents);

    if (absCents < policy.deadbandCents) {
      skipped.push({ start, end, reason: 'within_deadband', deviationCents: round(correctionCents, 2) });
      continue;
    }
    if (absCents > policy.maxCorrectionCents) {
      skipped.push({ start, end, reason: 'correction_exceeds_guard', deviationCents: round(correctionCents, 2) });
      continue;
    }

    corrections.push(Object.freeze({
      start: round(start, 6),
      end: round(end, 6),
      durationSeconds: round(duration, 6),
      sourceMedianMidi: round(medianMidi, 6),
      targetMidi,
      correctionCents: round(correctionCents, 3),
      correctionSemitones: round(correctionCents / 100, 6),
      confidence: round(confidence, 6),
      targetSource: explicit ? 'explicit' : 'nearest_chromatic',
      preserveFormants: policy.preserveFormants === true,
      preserveRelativeVibrato: policy.preserveRelativeVibrato === true,
      crossfadeSeconds: policy.crossfadeSeconds,
    }));
  }

  return Object.freeze({
    policy: Object.freeze({ ...policy }),
    corrections: Object.freeze(corrections),
    skipped: Object.freeze(skipped),
    correctionCount: corrections.length,
    correctedSeconds: round(corrections.reduce((sum, item) => sum + item.durationSeconds, 0), 6),
  });
}

export function classifyNoteCorrectionReadiness({ analyzerPresent, plannerPresent, rendererPresent, formantPreserving, retainedBenchmarkOutput = false } = {}) {
  const implementationReady = [analyzerPresent, plannerPresent, rendererPresent, formantPreserving].every(Boolean);
  return Object.freeze({
    implementationReady,
    retainedBenchmarkOutput: retainedBenchmarkOutput === true,
    scorable: implementationReady && retainedBenchmarkOutput === true,
    state: implementationReady
      ? retainedBenchmarkOutput === true ? 'evidence_ready' : 'implementation_ready_unexecuted'
      : 'partial_non_promotable',
  });
}

function normalizeTargets(targets) {
  return (targets || []).map((target) => ({
    start: Number(target?.start),
    end: Number(target?.end),
    targetMidi: Number(target?.targetMidi),
  })).filter((target) =>
    Number.isFinite(target.start) && Number.isFinite(target.end) && target.end > target.start && Number.isFinite(target.targetMidi)
  );
}

function overlaps(a0, a1, b0, b1) {
  return Math.max(a0, b0) < Math.min(a1, b1);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
