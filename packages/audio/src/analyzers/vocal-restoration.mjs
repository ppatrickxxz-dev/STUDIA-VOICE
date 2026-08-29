export const VOCAL_RESTORATION_PROFILE = Object.freeze({
  source: 'local-vocal-restoration-profile-v1',
  windowSeconds: 1.2,
  hopSeconds: 0.6,
  frameSeconds: 0.024,
  frameHopSeconds: 0.012,
  minNoiseConfidence: 0.72,
  minReverbConfidence: 0.72,
  minVoicedMarginDb: 10,
  maxNoiseReductionDb: 5.5,
  maxDereverbAmount: 0.2,
});

export function analyzeVocalRestoration(samples, {
  sampleRate = 48000,
  pitchContour = [],
  windowSeconds = VOCAL_RESTORATION_PROFILE.windowSeconds,
  hopSeconds = VOCAL_RESTORATION_PROFILE.hopSeconds,
  frameSeconds = VOCAL_RESTORATION_PROFILE.frameSeconds,
  frameHopSeconds = VOCAL_RESTORATION_PROFILE.frameHopSeconds,
} = {}) {
  if (!samples || typeof samples.length !== 'number' || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return emptyProfile();
  }

  const minimumSamples = Math.max(256, Math.floor(sampleRate * 0.35));
  if (samples.length < minimumSamples) return emptyProfile();

  const windowSize = Math.max(minimumSamples, Math.floor(sampleRate * windowSeconds));
  const hopSize = Math.max(1, Math.floor(sampleRate * hopSeconds));
  const starts = windowStarts(samples.length, windowSize, hopSize);
  const windows = stabilizeReflectionWindows(starts.map((start, index) => analyzeWindow(samples, {
    index,
    start,
    end: Math.min(samples.length, start + windowSize),
    sampleRate,
    pitchContour,
    frameSize: Math.max(128, Math.floor(sampleRate * frameSeconds)),
    frameHop: Math.max(64, Math.floor(sampleRate * frameHopSeconds)),
  })));

  const noiseWindows = windows.filter((window) => window.noise.actionable);
  const reverbWindows = windows.filter((window) => window.reverb.actionable);
  return {
    source: VOCAL_RESTORATION_PROFILE.source,
    windows,
    noiseWindowCount: noiseWindows.length,
    reverbWindowCount: reverbWindows.length,
    summary: {
      noiseFloorDb: roundedMedian(noiseWindows.map((window) => window.noise.noiseFloorDb), 1),
      snrDb: roundedMedian(noiseWindows.map((window) => window.noise.snrDb), 1),
      reflectionDelayMs: roundedMedian(reverbWindows.map((window) => window.reverb.reflectionDelayMs), 1),
      reflectionCorrelation: roundedMedian(reverbWindows.map((window) => window.reverb.correlation), 3),
    },
    timbreGuard: {
      pitchPreserving: true,
      formantPreserving: true,
      voicedMarginDb: VOCAL_RESTORATION_PROFILE.minVoicedMarginDb,
      maxNoiseReductionDb: VOCAL_RESTORATION_PROFILE.maxNoiseReductionDb,
      maxDereverbAmount: VOCAL_RESTORATION_PROFILE.maxDereverbAmount,
      source: 'bounded-vocal-timbre-guard-v1',
    },
  };
}

function analyzeWindow(samples, { index, start, end, sampleRate, pitchContour, frameSize, frameHop }) {
  const levels = levelFrames(samples, { start, end, sampleRate, pitchContour, frameSize, frameHop });
  const noise = noiseProfile(levels);
  const reverb = reflectionProfile(samples, { start, end, sampleRate, pitchContour });
  return {
    id: `restoration-window-${index + 1}`,
    start: roundMillis(start / sampleRate),
    end: roundMillis(end / sampleRate),
    noise,
    reverb,
  };
}

function stabilizeReflectionWindows(windows) {
  const candidates = windows.filter((window) => window.reverb.actionable && Number.isFinite(Number(window.reverb.reflectionDelayMs)));
  if (!candidates.length) return windows;
  if (candidates.length === 1) {
    candidates[0].reverb.delayConsistent = Number(candidates[0].reverb.confidence) >= 0.9;
    candidates[0].reverb.actionable = candidates[0].reverb.delayConsistent;
    return windows;
  }
  const clusters = [];
  for (const window of candidates) {
    const delay = Number(window.reverb.reflectionDelayMs);
    let cluster = clusters.find((item) => Math.abs(item.center - delay) <= 2.5);
    if (!cluster) {
      cluster = { center: delay, windows: [] };
      clusters.push(cluster);
    }
    cluster.windows.push(window);
    cluster.center = median(cluster.windows.map((item) => Number(item.reverb.reflectionDelayMs)));
  }
  clusters.sort((a, b) => b.windows.length - a.windows.length
    || summedProminence(b.windows) - summedProminence(a.windows));
  const accepted = new Set(clusters[0].windows);
  const consensusReady = clusters[0].windows.length >= 2;
  for (const window of candidates) {
    window.reverb.delayConsistent = consensusReady && accepted.has(window);
    window.reverb.actionable = window.reverb.actionable && window.reverb.delayConsistent;
  }
  return windows;
}

function summedProminence(windows) {
  return windows.reduce((sum, window) => sum + (Number(window.reverb.prominence) || 0), 0);
}

function levelFrames(samples, { start, end, sampleRate, pitchContour, frameSize, frameHop }) {
  const frames = [];
  for (let offset = start; offset + frameSize <= end; offset += frameHop) {
    let sumSquares = 0;
    for (let index = 0; index < frameSize; index += 1) {
      const value = Number(samples[offset + index]) || 0;
      sumSquares += value * value;
    }
    const rms = Math.sqrt(sumSquares / frameSize);
    const time = (offset + frameSize / 2) / sampleRate;
    const pitch = nearestPitchPoint(pitchContour, time);
    frames.push({
      time,
      rms,
      rmsDb: amplitudeToDb(rms),
      voiced: Boolean(pitch?.voiced && Number(pitch?.confidence) >= 0.42),
      pitchConfidence: clamp01(pitch?.confidence),
    });
  }
  return frames;
}

function noiseProfile(frames) {
  const audible = frames.filter((frame) => frame.rmsDb > -78);
  const unvoiced = audible.filter((frame) => !frame.voiced).sort((a, b) => a.rmsDb - b.rmsDb);
  const voiced = audible.filter((frame) => frame.voiced);
  const quietCount = Math.max(0, Math.ceil(unvoiced.length * 0.55));
  const quiet = unvoiced.slice(0, quietCount);
  const noiseFloorDb = median(quiet.map((frame) => frame.rmsDb));
  const voicedLevelDb = median(voiced.map((frame) => frame.rmsDb));
  const snrDb = finitePair(voicedLevelDb, noiseFloorDb) ? voicedLevelDb - noiseFloorDb : null;
  const consistencyDb = iqr(quiet.map((frame) => frame.rmsDb));
  const coverage = clamp01(Math.min(quiet.length, voiced.length) / 8);
  const consistency = consistencyDb == null ? 0 : 1 - smoothStep(3, 11, consistencyDb);
  const audibleNoise = noiseFloorDb == null ? 0 : smoothStep(-58, -34, noiseFloorDb);
  const usefulSnr = snrDb == null ? 0 : rangeScore(snrDb, 5.5, 32, 8, 24);
  const confidence = clamp01(0.28 * coverage + 0.24 * consistency + 0.24 * audibleNoise + 0.24 * usefulSnr);
  const thresholdDb = finitePair(noiseFloorDb, voicedLevelDb)
    ? Math.min(noiseFloorDb + 5, voicedLevelDb - VOCAL_RESTORATION_PROFILE.minVoicedMarginDb)
    : null;
  const voicedMarginDb = finitePair(voicedLevelDb, thresholdDb) ? voicedLevelDb - thresholdDb : null;
  const reductionDb = snrDb == null ? 0 : clamp(2.5 + Math.max(0, 21 - snrDb) * 0.22, 2.5, VOCAL_RESTORATION_PROFILE.maxNoiseReductionDb);
  const actionable = confidence >= VOCAL_RESTORATION_PROFILE.minNoiseConfidence
    && noiseFloorDb >= -58
    && snrDb >= 5.5
    && snrDb <= 29
    && voicedMarginDb >= VOCAL_RESTORATION_PROFILE.minVoicedMarginDb
    && quiet.length >= 4
    && voiced.length >= 4;

  return {
    actionable,
    confidence: roundHundredth(confidence),
    noiseFloorDb: roundTenthOrNull(noiseFloorDb),
    voicedLevelDb: roundTenthOrNull(voicedLevelDb),
    snrDb: roundTenthOrNull(snrDb),
    thresholdDb: roundTenthOrNull(thresholdDb),
    voicedMarginDb: roundTenthOrNull(voicedMarginDb),
    reductionDb: roundTenth(reductionDb),
    quietFrameCount: quiet.length,
    voicedFrameCount: voiced.length,
    source: 'vocal-noise-floor-v1',
  };
}

function reflectionProfile(samples, { start, end, sampleRate, pitchContour }) {
  const step = Math.max(1, Math.round(sampleRate / 4000));
  const whitened = [];
  const voiced = [];
  let previous = Number(samples[start]) || 0;
  for (let offset = start; offset < end; offset += step) {
    const value = Number(samples[offset]) || 0;
    whitened.push(value - previous);
    const pitch = nearestPitchPoint(pitchContour, offset / sampleRate);
    voiced.push(Boolean(pitch?.voiced && Number(pitch?.confidence) >= 0.42));
    previous = value;
  }
  if (whitened.length < 80) return emptyReflection();
  const energy = whitened.reduce((sum, value) => sum + value * value, 0) / whitened.length;
  if (energy <= 1e-10) return emptyReflection();

  const hopMs = step * 1000 / sampleRate;
  const minLag = Math.max(1, Math.ceil(18 / hopMs));
  const maxLag = Math.min(whitened.length - 4, Math.floor(90 / hopMs));
  const candidates = [];
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const correlation = maskedCorrelation(whitened, voiced, lag);
    candidates.push({ lag, correlation });
  }
  const localPeaks = candidates.filter((candidate, index) => index > 1 && index < candidates.length - 2
    && candidate.correlation > candidates[index - 1].correlation
    && candidate.correlation >= candidates[index + 1].correlation);
  if (!localPeaks.length) return emptyReflection();
  localPeaks.sort((a, b) => b.correlation - a.correlation);
  const best = localPeaks[0];
  const correlations = candidates.map((candidate) => candidate.correlation).sort((a, b) => a - b);
  const baselineCorrelation = percentile(correlations, 0.75) ?? 0;
  const prominence = Math.max(0, best.correlation - baselineCorrelation);
  const correlationScore = smoothStep(0.075, 0.18, best.correlation);
  const prominenceScore = smoothStep(0.03, 0.1, prominence);
  const activityScore = smoothStep(1e-7, 2e-4, energy);
  const confidence = clamp01(0.46 * correlationScore + 0.42 * prominenceScore + 0.12 * activityScore);
  const reflectionDelayMs = best.lag * hopMs;
  const amount = clamp(0.08 + 0.42 * prominence + 0.16 * Math.max(0, best.correlation - 0.08), 0.08, VOCAL_RESTORATION_PROFILE.maxDereverbAmount);
  const actionable = confidence >= VOCAL_RESTORATION_PROFILE.minReverbConfidence
    && best.correlation >= 0.1
    && prominence >= 0.04
    && reflectionDelayMs >= 18
    && reflectionDelayMs <= 90;
  return {
    actionable,
    confidence: roundHundredth(confidence),
    reflectionDelayMs: roundTenth(reflectionDelayMs),
    correlation: roundThousandth(best.correlation),
    prominence: roundThousandth(prominence),
    amount: roundHundredth(amount),
    dampingHz: 5200,
    source: 'vocal-early-reflection-v1',
    delayConsistent: false,
  };
}

function maskedCorrelation(values, voiced, lag) {
  let cross = 0;
  let left = 0;
  let right = 0;
  let count = 0;
  for (let index = lag; index < values.length; index += 1) {
    if (voiced[index] && voiced[index - lag]) continue;
    const a = values[index];
    const b = values[index - lag];
    cross += a * b;
    left += a * a;
    right += b * b;
    count += 1;
  }
  const denominator = Math.sqrt(left * right);
  return count >= 40 && denominator > 1e-12 ? clamp(cross / denominator, -1, 1) : 0;
}

function nearestPitchPoint(contour, time) {
  if (!Array.isArray(contour) || !contour.length) return null;
  let low = 0;
  let high = contour.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (Number(contour[middle]?.time) < time) low = middle + 1;
    else high = middle;
  }
  const current = contour[low];
  const previous = contour[Math.max(0, low - 1)];
  return Math.abs(Number(previous?.time) - time) <= Math.abs(Number(current?.time) - time) ? previous : current;
}

function windowStarts(length, windowSize, hopSize) {
  if (length <= windowSize) return [0];
  const starts = [];
  for (let start = 0; start + windowSize <= length; start += hopSize) starts.push(start);
  const finalStart = Math.max(0, length - windowSize);
  if (starts.at(-1) !== finalStart) starts.push(finalStart);
  return starts;
}

function emptyProfile() {
  return {
    source: VOCAL_RESTORATION_PROFILE.source,
    windows: [],
    noiseWindowCount: 0,
    reverbWindowCount: 0,
    summary: { noiseFloorDb: null, snrDb: null, reflectionDelayMs: null, reflectionCorrelation: null },
    timbreGuard: {
      pitchPreserving: true,
      formantPreserving: true,
      voicedMarginDb: VOCAL_RESTORATION_PROFILE.minVoicedMarginDb,
      maxNoiseReductionDb: VOCAL_RESTORATION_PROFILE.maxNoiseReductionDb,
      maxDereverbAmount: VOCAL_RESTORATION_PROFILE.maxDereverbAmount,
      source: 'bounded-vocal-timbre-guard-v1',
    },
  };
}

function emptyReflection() {
  return {
    actionable: false,
    confidence: 0,
    reflectionDelayMs: null,
    correlation: 0,
    prominence: 0,
    amount: 0,
    dampingHz: 5200,
    source: 'vocal-early-reflection-v1',
  };
}

function amplitudeToDb(value) { return 20 * Math.log10(Math.max(1e-9, Number(value) || 0)); }
function finitePair(a, b) { return Number.isFinite(Number(a)) && Number.isFinite(Number(b)); }
function median(values) { return percentile(values.filter(Number.isFinite).sort((a, b) => a - b), 0.5); }
function iqr(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return Number(percentile(sorted, 0.75)) - Number(percentile(sorted, 0.25));
}
function percentile(values, position) {
  if (!values.length) return null;
  const index = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * position)));
  return values[index];
}
function roundedMedian(values, decimals) {
  const value = median(values);
  return value == null ? null : round(value, decimals);
}
function rangeScore(value, min, max, idealMin, idealMax) {
  if (value <= min || value >= max) return 0;
  if (value >= idealMin && value <= idealMax) return 1;
  if (value < idealMin) return (value - min) / Math.max(1e-9, idealMin - min);
  return (max - value) / Math.max(1e-9, max - idealMax);
}
function smoothStep(edge0, edge1, value) {
  const amount = clamp01((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}
function round(value, decimals) { const scale = 10 ** decimals; return Math.round(Number(value) * scale) / scale; }
function roundMillis(value) { return round(value, 3); }
function roundTenth(value) { return round(value, 1); }
function roundHundredth(value) { return round(value, 2); }
function roundThousandth(value) { return round(value, 3); }
function roundTenthOrNull(value) { return Number.isFinite(Number(value)) ? roundTenth(value) : null; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function clamp01(value) { return clamp(value, 0, 1); }
