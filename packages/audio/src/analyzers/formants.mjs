export const FORMANT_PROFILE = Object.freeze({
  source: 'local-spectral-formant-profile-v1',
  frameSeconds: 0.032,
  hopSeconds: 0.024,
  maxFrames: 18,
  minFrameRmsDb: -52,
  minConfidence: 0.58,
  bandsHz: Object.freeze([
    Object.freeze([180, 1000]),
    Object.freeze([700, 3000]),
    Object.freeze([1800, 4200]),
  ]),
});

export function analyzeFormants(samples, {
  sampleRate = 48000,
  pitchContour = [],
  frameSeconds = FORMANT_PROFILE.frameSeconds,
  hopSeconds = FORMANT_PROFILE.hopSeconds,
  maxFrames = FORMANT_PROFILE.maxFrames,
} = {}) {
  if (!samples || typeof samples.length !== 'number' || !Number.isFinite(sampleRate) || sampleRate < 8000) {
    return emptyProfile();
  }

  const frameSize = Math.max(256, Math.min(1024, nearestPowerOfTwo(Math.floor(sampleRate * frameSeconds))));
  if (samples.length < frameSize) return emptyProfile();
  const hopSize = Math.max(1, Math.floor(sampleRate * hopSeconds));
  const starts = selectFrameStarts(samples.length, frameSize, hopSize, maxFrames);
  const frames = [];

  for (const start of starts) {
    const centerSeconds = (start + frameSize / 2) / sampleRate;
    const pitch = nearestPitchPoint(pitchContour, centerSeconds);
    if (pitchContour.length && !(pitch?.voiced && Number(pitch?.confidence) >= 0.42)) continue;
    const frame = prepareFrame(samples, start, frameSize);
    const rmsDb = amplitudeToDb(frame.rms);
    if (rmsDb < FORMANT_PROFILE.minFrameRmsDb) continue;
    const estimate = estimateFrameFormants(frame.values, sampleRate);
    if (!estimate.formantsHz.length) continue;
    frames.push({
      time: roundMillis(centerSeconds),
      rmsDb: roundTenth(rmsDb),
      formantsHz: estimate.formantsHz,
      prominenceDb: estimate.prominenceDb,
      confidence: estimate.confidence,
    });
  }

  if (frames.length < 3) return { ...emptyProfile(), frames };
  const formantsHz = [0, 1, 2].map((index) => roundedMedian(
    frames.map((frame) => frame.formantsHz[index]).filter(Number.isFinite),
    1,
  ));
  if (formantsHz.some((value) => !Number.isFinite(value))) return { ...emptyProfile(), frames };

  const stability = formantStability(frames, formantsHz);
  const prominence = median(frames.flatMap((frame) => frame.prominenceDb).filter(Number.isFinite)) ?? 0;
  const coverage = Math.min(1, frames.length / Math.min(8, Math.max(3, starts.length)));
  const prominenceScore = smoothStep(2.5, 10, prominence);
  const confidence = clamp01(0.42 * coverage + 0.34 * stability + 0.24 * prominenceScore);

  return {
    source: FORMANT_PROFILE.source,
    formantsHz,
    confidence: roundHundredth(confidence),
    stable: confidence >= FORMANT_PROFILE.minConfidence,
    frameCount: frames.length,
    stability: roundHundredth(stability),
    medianProminenceDb: roundTenth(prominence),
    frames,
  };
}

function estimateFrameFormants(frame, sampleRate) {
  const halfBins = Math.floor(frame.length / 2);
  const power = new Float64Array(halfBins + 1);
  const maxFrequency = Math.min(4500, sampleRate / 2 - 1);
  const maxBin = Math.min(halfBins, Math.floor(maxFrequency * frame.length / sampleRate));

  for (let bin = 1; bin <= maxBin; bin += 1) {
    power[bin] = Math.log10(1e-12 + goertzelPower(frame, bin));
  }

  const binHz = sampleRate / frame.length;
  const smoothingRadius = Math.max(2, Math.round(140 / binHz));
  const smooth = smoothSpectrum(power, maxBin, smoothingRadius);
  const selected = [];
  const prominenceDb = [];

  for (let bandIndex = 0; bandIndex < FORMANT_PROFILE.bandsHz.length; bandIndex += 1) {
    const [lowHz, highHz] = FORMANT_PROFILE.bandsHz[bandIndex];
    const minimumHz = selected.length ? Math.max(lowHz, selected.at(-1) + 180) : lowHz;
    const lowBin = Math.max(1, Math.ceil(minimumHz / binHz));
    const highBin = Math.min(maxBin - 1, Math.floor(highHz / binHz));
    if (highBin <= lowBin) return { formantsHz: [], prominenceDb: [], confidence: 0 };

    let bestBin = lowBin;
    for (let bin = lowBin + 1; bin <= highBin; bin += 1) {
      if (smooth[bin] > smooth[bestBin]) bestBin = bin;
    }
    const baseline = median(Array.from(smooth.slice(lowBin, highBin + 1))) ?? smooth[bestBin];
    const prominence = Math.max(0, (smooth[bestBin] - baseline) * 10);
    selected.push(roundTenth(bestBin * binHz));
    prominenceDb.push(roundTenth(prominence));
  }

  const ordered = selected[0] < selected[1] && selected[1] < selected[2];
  const meanProminence = prominenceDb.reduce((sum, value) => sum + value, 0) / prominenceDb.length;
  const confidence = ordered ? clamp01(0.45 + 0.55 * smoothStep(2, 10, meanProminence)) : 0;
  return { formantsHz: ordered ? selected : [], prominenceDb, confidence: roundHundredth(confidence) };
}

function goertzelPower(frame, bin) {
  const omega = 2 * Math.PI * bin / frame.length;
  const coefficient = 2 * Math.cos(omega);
  let previous = 0;
  let previous2 = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const current = frame[index] + coefficient * previous - previous2;
    previous2 = previous;
    previous = current;
  }
  return Math.max(0, previous2 * previous2 + previous * previous - coefficient * previous * previous2);
}

function prepareFrame(samples, start, size) {
  const values = new Float64Array(size);
  let squares = 0;
  let previous = Number(samples[start]) || 0;
  for (let index = 0; index < size; index += 1) {
    const input = Number(samples[start + index]) || 0;
    squares += input * input;
    const emphasized = index === 0 ? input : input - 0.97 * previous;
    const window = 0.54 - 0.46 * Math.cos(2 * Math.PI * index / Math.max(1, size - 1));
    values[index] = emphasized * window;
    previous = input;
  }
  return { values, rms: Math.sqrt(squares / size) };
}

function smoothSpectrum(power, maxBin, radius) {
  const result = new Float64Array(power.length);
  const prefix = new Float64Array(maxBin + 2);
  for (let index = 0; index <= maxBin; index += 1) prefix[index + 1] = prefix[index] + power[index];
  for (let bin = 1; bin <= maxBin; bin += 1) {
    const start = Math.max(1, bin - radius);
    const end = Math.min(maxBin, bin + radius);
    result[bin] = (prefix[end + 1] - prefix[start]) / Math.max(1, end - start + 1);
  }
  return result;
}

function formantStability(frames, medians) {
  const cents = [];
  for (const frame of frames) {
    for (let index = 0; index < 3; index += 1) {
      const value = Number(frame.formantsHz[index]);
      const reference = Number(medians[index]);
      if (value > 0 && reference > 0) cents.push(Math.abs(1200 * Math.log2(value / reference)));
    }
  }
  const drift = median(cents) ?? 1200;
  return 1 - smoothStep(70, 360, drift);
}

function selectFrameStarts(length, frameSize, hopSize, maxFrames) {
  const all = [];
  for (let start = 0; start + frameSize <= length; start += hopSize) all.push(start);
  if (all.length <= maxFrames) return all;
  const selected = [];
  for (let index = 0; index < maxFrames; index += 1) {
    selected.push(all[Math.round(index * (all.length - 1) / Math.max(1, maxFrames - 1))]);
  }
  return [...new Set(selected)];
}

function nearestPitchPoint(contour, time) {
  if (!Array.isArray(contour) || !contour.length) return null;
  let best = contour[0];
  let distance = Math.abs(Number(best?.time) - time);
  for (const point of contour) {
    const nextDistance = Math.abs(Number(point?.time) - time);
    if (nextDistance < distance) { best = point; distance = nextDistance; }
  }
  return best;
}

function nearestPowerOfTwo(value) {
  const safe = Math.max(256, Number(value) || 256);
  return 2 ** Math.round(Math.log2(safe));
}
function emptyProfile() {
  return {
    source: FORMANT_PROFILE.source,
    formantsHz: [],
    confidence: 0,
    stable: false,
    frameCount: 0,
    stability: 0,
    medianProminenceDb: null,
    frames: [],
  };
}
function amplitudeToDb(value) { return 20 * Math.log10(Math.max(1e-9, Number(value) || 0)); }
function smoothStep(edge0, edge1, value) {
  const amount = clamp01((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}
function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function roundedMedian(values, digits) {
  const value = median(values);
  return value === null ? null : Number(value.toFixed(digits));
}
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function roundMillis(value) { return Math.round(value * 1000) / 1000; }
function roundTenth(value) { return Math.round((Number(value) || 0) * 10) / 10; }
function roundHundredth(value) { return Math.round((Number(value) || 0) * 100) / 100; }
