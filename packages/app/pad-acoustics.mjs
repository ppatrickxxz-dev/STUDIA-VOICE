export const PAD_ACOUSTIC_SCHEMA = 'pablovoice_pad_acoustics_v1';
export const PAD_CATEGORIES = Object.freeze(['kick', 'snare', 'clap', 'closed_hat', 'open_hat', 'percussion', 'unknown']);

const CATEGORY_LABELS = Object.freeze({
  kick: 'Kick',
  snare: 'Caixa',
  clap: 'Clap',
  closed_hat: 'Chimbal fechado',
  open_hat: 'Chimbal aberto',
  percussion: 'Percussão',
  unknown: 'Som',
});

export function analyzePadAcoustics(samples, { sampleRate = 48000, start = 0, end = null, maxAnalysisSeconds = 0.22 } = {}) {
  if (!samples?.length || !Number.isFinite(Number(sampleRate)) || Number(sampleRate) <= 0) return emptyFeatures();
  const sr = Number(sampleRate);
  const startFrame = clamp(Math.floor(Math.max(0, Number(start) || 0) * sr), 0, samples.length - 1);
  const resolvedEndSeconds = Number.isFinite(Number(end)) ? Number(end) : samples.length / sr;
  const endFrame = clamp(Math.ceil(Math.max(Number(start) || 0, resolvedEndSeconds) * sr), startFrame + 1, samples.length);
  const duration = Math.max(0, (endFrame - startFrame) / sr);
  const analysisFrames = Math.max(1, Math.min(endFrame - startFrame, Math.floor(sr * maxAnalysisSeconds)));
  const analysisEnd = startFrame + analysisFrames;

  let mean = 0;
  for (let i = startFrame; i < analysisEnd; i += 1) mean += Number(samples[i]) || 0;
  mean /= analysisFrames;

  let sumSquares = 0;
  let peak = 0;
  let crossings = 0;
  let previous = (Number(samples[startFrame]) || 0) - mean;
  for (let i = startFrame; i < analysisEnd; i += 1) {
    const value = (Number(samples[i]) || 0) - mean;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (i > startFrame && ((previous < 0 && value >= 0) || (previous >= 0 && value < 0))) crossings += 1;
    previous = value;
  }
  const rms = Math.sqrt(sumSquares / analysisFrames);
  const zeroCrossRate = crossings / Math.max(1, analysisFrames - 1);
  const earlyFrames = Math.max(1, Math.min(analysisFrames, Math.floor(sr * 0.025)));
  const tailFrames = Math.max(1, Math.floor(analysisFrames * 0.25));
  const earlyRms = rangeRms(samples, startFrame, startFrame + earlyFrames, mean);
  const tailRms = rangeRms(samples, analysisEnd - tailFrames, analysisEnd, mean);
  const transientness = clamp((earlyRms / Math.max(1e-7, rms) - 0.72) / 1.15, 0, 1);
  const decay = clamp(1 - tailRms / Math.max(1e-7, earlyRms), 0, 1);

  const centers = [70, 120, 220, 500, 1200, 3000, 6000, 10000].filter((hz) => hz < sr * 0.46);
  const energies = centers.map((hz) => goertzelEnergy(samples, startFrame, analysisEnd, sr, hz, mean));
  const totalEnergy = energies.reduce((sum, value) => sum + value, 0) || 1;
  let lowEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;
  let centroidNumerator = 0;
  centers.forEach((hz, index) => {
    const energy = energies[index];
    centroidNumerator += hz * energy;
    if (hz <= 260) lowEnergy += energy;
    else if (hz <= 3200) midEnergy += energy;
    else highEnergy += energy;
  });

  return {
    schema: PAD_ACOUSTIC_SCHEMA,
    duration,
    rms,
    peak,
    crest: rms > 1e-7 ? peak / rms : 0,
    zeroCrossRate,
    earlyRms,
    tailRms,
    transientness,
    decay,
    lowRatio: clamp(lowEnergy / totalEnergy, 0, 1),
    midRatio: clamp(midEnergy / totalEnergy, 0, 1),
    highRatio: clamp(highEnergy / totalEnergy, 0, 1),
    centroidHz: totalEnergy > 0 ? centroidNumerator / totalEnergy : 0,
  };
}

export function classifyPadAcoustics(features = {}) {
  const f = normalizeFeatures(features);
  if (f.rms < 1e-5 || f.duration <= 0.01) return classification('unknown', 0, f, {});

  const zcr = clamp(f.zeroCrossRate / 0.24, 0, 1);
  const centroidLow = 1 - clamp((f.centroidHz - 220) / 1800, 0, 1);
  const centroidHigh = clamp((f.centroidHz - 1600) / 5200, 0, 1);
  const short = 1 - clamp((f.duration - 0.08) / 0.35, 0, 1);
  const veryShort = 1 - clamp((f.duration - 0.055) / 0.18, 0, 1);
  const openDuration = triangle(f.duration, 0.16, 0.42, 1.1);
  const percussionDuration = triangle(f.duration, 0.035, 0.22, 0.9);
  const sustain = 1 - f.decay;

  const scores = {
    kick: 0.46 * f.lowRatio + 0.19 * centroidLow + 0.16 * f.transientness + 0.11 * f.decay + 0.08 * percussionDuration,
    snare: 0.31 * f.midRatio + 0.21 * f.highRatio + 0.16 * zcr + 0.16 * f.transientness + 0.10 * f.decay + 0.06 * short,
    clap: 0.27 * f.midRatio + 0.29 * f.highRatio + 0.18 * zcr + 0.16 * f.transientness + 0.10 * veryShort,
    closed_hat: 0.46 * f.highRatio + 0.20 * zcr + 0.15 * centroidHigh + 0.12 * veryShort + 0.07 * f.transientness,
    open_hat: 0.40 * f.highRatio + 0.18 * zcr + 0.14 * centroidHigh + 0.18 * openDuration + 0.10 * sustain,
    percussion: 0.24 * f.midRatio + 0.20 * f.lowRatio + 0.14 * f.highRatio + 0.20 * f.transientness + 0.12 * f.decay + 0.10 * percussionDuration,
  };
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [bestCategory, bestScore] = ranked[0];
  const secondScore = ranked[1]?.[1] || 0;
  if (bestScore < 0.39) return classification('unknown', clamp(bestScore * 0.7, 0, 0.45), f, scores);
  const margin = Math.max(0, bestScore - secondScore);
  const confidence = clamp(bestScore * 0.78 + margin * 1.15, 0, 1);
  return classification(bestCategory, confidence, f, scores);
}

export function classifySamplerPads(state = {}, samples, sampleRate) {
  const pads = Array.isArray(state?.pads) ? state.pads : [];
  const classified = pads.map((pad) => {
    const features = analyzePadAcoustics(samples, { sampleRate, start: pad.start, end: pad.end });
    const result = classifyPadAcoustics(features);
    return {
      ...pad,
      category: result.category,
      categoryConfidence: result.confidence,
      categorySource: result.source,
      acoustic: result.features,
    };
  });
  return { ...state, pads: classified, updatedAt: Date.now() };
}

export function padCategoryLabel(category) {
  return CATEGORY_LABELS[PAD_CATEGORIES.includes(category) ? category : 'unknown'];
}

function classification(category, confidence, features, scores) {
  return {
    category: PAD_CATEGORIES.includes(category) ? category : 'unknown',
    confidence: clamp(Number(confidence) || 0, 0, 1),
    source: 'local_acoustic_heuristic_v1',
    features,
    scores,
  };
}

function normalizeFeatures(input = {}) {
  return {
    schema: PAD_ACOUSTIC_SCHEMA,
    duration: Math.max(0, finite(input.duration, 0)),
    rms: Math.max(0, finite(input.rms, 0)),
    peak: Math.max(0, finite(input.peak, 0)),
    crest: Math.max(0, finite(input.crest, 0)),
    zeroCrossRate: clamp(finite(input.zeroCrossRate, 0), 0, 1),
    earlyRms: Math.max(0, finite(input.earlyRms, 0)),
    tailRms: Math.max(0, finite(input.tailRms, 0)),
    transientness: clamp(finite(input.transientness, 0), 0, 1),
    decay: clamp(finite(input.decay, 0), 0, 1),
    lowRatio: clamp(finite(input.lowRatio, 0), 0, 1),
    midRatio: clamp(finite(input.midRatio, 0), 0, 1),
    highRatio: clamp(finite(input.highRatio, 0), 0, 1),
    centroidHz: Math.max(0, finite(input.centroidHz, 0)),
  };
}

function emptyFeatures() {
  return normalizeFeatures({});
}

function rangeRms(samples, start, end, mean) {
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, start); i < Math.min(samples.length, end); i += 1) {
    const value = (Number(samples[i]) || 0) - mean;
    sum += value * value;
    count += 1;
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function goertzelEnergy(samples, start, end, sampleRate, frequency, mean) {
  const count = Math.max(1, end - start);
  const omega = 2 * Math.PI * frequency / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = start; i < end; i += 1) {
    const n = i - start;
    const window = count > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (count - 1)) : 1;
    const value = ((Number(samples[i]) || 0) - mean) * window;
    s0 = value + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2) / (count * count);
}

function triangle(value, min, peak, max) {
  if (value <= min || value >= max) return 0;
  if (value === peak) return 1;
  if (value < peak) return (value - min) / Math.max(1e-6, peak - min);
  return (max - value) / Math.max(1e-6, max - peak);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
