import { normalizeOnsetEvents } from './onset-utils.mjs';

export const GROOVE_TEMPLATE_SCHEMA = 'pablovoice_groove_template_v1';
export const GROOVE_STEPS_PER_BAR = 16;

export function extractGrooveTemplate(analysis, {
  stepsPerBar = GROOVE_STEPS_PER_BAR,
  minTempoConfidence = 0.35,
  minOnsetConfidence = 0.35,
  maxDeviationBeats = 0.12,
} = {}) {
  const bpm = Number(analysis?.music?.bpm);
  const tempoConfidence = clamp(Number(analysis?.music?.bpmConfidence ?? analysis?.confidence?.tempo ?? 0), 0, 1);
  const resolvedSteps = clamp(Math.round(Number(stepsPerBar) || GROOVE_STEPS_PER_BAR), 4, 32);
  if (!Number.isFinite(bpm) || bpm <= 0) return unavailable('tempo_unavailable', bpm, tempoConfidence, resolvedSteps);
  if (tempoConfidence < minTempoConfidence) return unavailable('low_tempo_confidence', bpm, tempoConfidence, resolvedSteps);

  const onsets = normalizeOnsetEvents(analysis?.signal?.onsets || analysis?.onsets || [], { minConfidence: minOnsetConfidence });
  if (onsets.length < 3) return unavailable('not_enough_onsets', bpm, tempoConfidence, resolvedSteps);

  const stepBeats = 0.25;
  const buckets = Array.from({ length: resolvedSteps }, () => []);
  const strengths = Array.from({ length: resolvedSteps }, () => []);
  let matched = 0;
  for (const onset of onsets) {
    const beat = onset.timeSeconds * bpm / 60;
    const nearestStep = Math.round(beat / stepBeats);
    const nearestBeat = nearestStep * stepBeats;
    const deviation = beat - nearestBeat;
    if (Math.abs(deviation) > maxDeviationBeats) continue;
    const bucket = positiveModulo(nearestStep, resolvedSteps);
    const weight = Math.max(0.05, onset.confidence);
    buckets[bucket].push({ value: deviation, weight });
    strengths[bucket].push({ value: onset.strength, weight });
    matched += 1;
  }
  if (matched < 3) return unavailable('not_enough_grid_matches', bpm, tempoConfidence, resolvedSteps);

  const maxStrength = Math.max(0, ...onsets.map((event) => Number(event.strength) || 0));
  const offsetsBeats = buckets.map((values) => clamp(weightedMean(values), -maxDeviationBeats, maxDeviationBeats));
  const accents = strengths.map((values) => maxStrength > 0 ? clamp(weightedMean(values) / maxStrength, 0, 1) : 0);
  const coveredSteps = buckets.filter((values) => values.length).length;
  const coverage = coveredSteps / resolvedSteps;
  const matchRatio = matched / Math.max(1, onsets.length);
  const onsetConfidence = onsets.reduce((sum, event) => sum + event.confidence, 0) / onsets.length;
  const confidence = clamp(tempoConfidence * (0.45 + coverage * 0.25 + matchRatio * 0.2 + onsetConfidence * 0.1), 0, 1);

  return normalizeGrooveTemplate({
    schema: GROOVE_TEMPLATE_SCHEMA,
    ready: confidence >= 0.35,
    reason: confidence >= 0.35 ? null : 'low_groove_confidence',
    source: 'onset_grid_v1',
    bpm,
    tempoConfidence,
    stepsPerBar: resolvedSteps,
    stepBeats,
    offsetsBeats,
    accents,
    matchedOnsets: matched,
    totalOnsets: onsets.length,
    coverage,
    confidence,
  });
}

export function normalizeGrooveTemplate(input = {}) {
  const steps = clamp(Math.round(Number(input?.stepsPerBar) || GROOVE_STEPS_PER_BAR), 4, 32);
  const offsets = Array.isArray(input?.offsetsBeats) ? input.offsetsBeats : [];
  const accents = Array.isArray(input?.accents) ? input.accents : [];
  return {
    schema: GROOVE_TEMPLATE_SCHEMA,
    ready: Boolean(input?.ready),
    reason: input?.reason ? String(input.reason).slice(0, 64) : null,
    source: String(input?.source || 'onset_grid_v1'),
    bpm: finite(input?.bpm, 0),
    tempoConfidence: clamp(finite(input?.tempoConfidence, 0), 0, 1),
    stepsPerBar: steps,
    stepBeats: clamp(finite(input?.stepBeats, 0.25), 0.0625, 1),
    offsetsBeats: Array.from({ length: steps }, (_, index) => clamp(finite(offsets[index], 0), -0.125, 0.125)),
    accents: Array.from({ length: steps }, (_, index) => clamp(finite(accents[index], 0), 0, 1)),
    matchedOnsets: Math.max(0, Math.floor(finite(input?.matchedOnsets, 0))),
    totalOnsets: Math.max(0, Math.floor(finite(input?.totalOnsets, 0))),
    coverage: clamp(finite(input?.coverage, 0), 0, 1),
    confidence: clamp(finite(input?.confidence, 0), 0, 1),
  };
}

function unavailable(reason, bpm, tempoConfidence, stepsPerBar) {
  return normalizeGrooveTemplate({
    ready: false,
    reason,
    bpm: Number.isFinite(bpm) ? bpm : 0,
    tempoConfidence,
    stepsPerBar,
  });
}

function weightedMean(values) {
  if (!values.length) return 0;
  let weighted = 0;
  let total = 0;
  for (const item of values) {
    const weight = Math.max(0.0001, finite(item?.weight, 1));
    weighted += finite(item?.value, 0) * weight;
    total += weight;
  }
  return total > 0 ? weighted / total : 0;
}

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
