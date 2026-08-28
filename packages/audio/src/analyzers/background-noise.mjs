const HUM_BASES = Object.freeze([50, 60]);
const DEFAULT_FRAME_SECONDS = 0.064;
const DEFAULT_HOP_SECONDS = 0.032;

export function detectBackgroundNoise(samples, {
  sampleRate = 48000,
  frameSize = null,
  hopSize = null,
  minRmsDb = -72,
  maxRmsDb = -24,
  minFrames = 3,
  mergeGapSeconds = 0.08,
  confidenceThreshold = 0.68,
  pitchContour = [],
  excludedEvents = [],
} = {}) {
  const resolvedFrameSize = positiveInteger(frameSize) || Math.max(256, Math.round(sampleRate * DEFAULT_FRAME_SECONDS));
  const resolvedHopSize = positiveInteger(hopSize) || Math.max(128, Math.round(sampleRate * DEFAULT_HOP_SECONDS));
  if (!samples || typeof samples.length !== 'number' || samples.length < resolvedFrameSize || !(sampleRate > 0)) {
    return { noiseEvents: [], frames: [] };
  }

  const frames = [];
  for (let start = 0; start + resolvedFrameSize <= samples.length; start += resolvedHopSize) {
    const end = start + resolvedFrameSize;
    const startSeconds = start / sampleRate;
    const endSeconds = end / sampleRate;
    const feature = analyzeNoiseFrame(samples, start, resolvedFrameSize, sampleRate);
    const voiced = overlapsVoicedPitch(startSeconds, endSeconds, pitchContour);
    const excluded = overlapsAny(startSeconds, endSeconds, excludedEvents, 0.012);
    const levelEligible = feature.rmsDb >= minRmsDb && feature.rmsDb <= maxRmsDb;
    const levelScore = smoothStep(minRmsDb, -34, feature.rmsDb);
    const broadbandScore = smoothStep(0.38, 1.05, feature.differenceRatio);
    const evidenceScore = Math.max(feature.humConfidence, broadbandScore * 0.88);
    const confidence = !voiced && !excluded && levelEligible
      ? clamp01(0.48 * evidenceScore + 0.32 * levelScore + 0.20 * (1 - smoothStep(0.65, 0.98, feature.crestFactor / 10)))
      : 0;
    frames.push({
      start: startSeconds,
      end: endSeconds,
      rmsDb: feature.rmsDb,
      differenceRatio: feature.differenceRatio,
      crestFactor: feature.crestFactor,
      humFrequencyHz: feature.humFrequencyHz,
      humConfidence: feature.humConfidence,
      voiced,
      excluded,
      eligible: !voiced && !excluded && levelEligible,
      confidence,
    });
  }

  const groups = mergeEligibleFrames(frames, { mergeGapSeconds, minFrames });
  const noiseEvents = groups
    .map(finalizeGroup)
    .filter((event) => event.confidence >= confidenceThreshold)
    .map((event) => ({ ...event, source: 'stationary-background-noise-v1' }));

  return { noiseEvents, frames };
}

export function analyzeNoiseFrame(samples, start, frameSize, sampleRate = 48000) {
  let sumSquares = 0;
  let differenceSquares = 0;
  let peak = 0;
  let previous = Number(samples[start]) || 0;
  for (let index = 0; index < frameSize; index += 1) {
    const value = Number(samples[start + index]) || 0;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (index > 0) {
      const difference = value - previous;
      differenceSquares += difference * difference;
    }
    previous = value;
  }
  const rms = Math.sqrt(sumSquares / frameSize);
  const differenceRms = Math.sqrt(differenceSquares / Math.max(1, frameSize - 1));
  const differenceRatio = differenceRms / Math.max(rms, 1e-12);
  const crestFactor = peak / Math.max(rms, 1e-12);
  const hum = humProfile(samples, start, frameSize, sampleRate, sumSquares);
  return {
    rms,
    rmsDb: amplitudeToDb(rms),
    peak,
    crestFactor,
    differenceRatio,
    ...hum,
  };
}

function humProfile(samples, start, frameSize, sampleRate, sumSquares) {
  const denominator = Math.max(1e-12, sumSquares * frameSize);
  const scores = HUM_BASES.map((baseHz) => {
    const harmonics = [1, 2, 3, 4].map((multiple) => {
      const frequencyHz = baseHz * multiple;
      return goertzelPower(samples, start, frameSize, sampleRate, frequencyHz) / denominator;
    });
    const score = 0.58 * harmonics[0] + 0.24 * harmonics[1] + 0.11 * harmonics[2] + 0.07 * harmonics[3];
    return { baseHz, score };
  }).sort((a, b) => b.score - a.score);
  const best = scores[0] || { baseHz: 50, score: 0 };
  return {
    humFrequencyHz: best.baseHz,
    humConfidence: smoothStep(0.008, 0.075, best.score),
    humStrength: best.score,
  };
}

function mergeEligibleFrames(frames, { mergeGapSeconds, minFrames }) {
  const groups = [];
  let current = null;
  for (const frame of frames) {
    if (!frame.eligible) {
      if (current) groups.push(current);
      current = null;
      continue;
    }
    const canMerge = current && frame.start - current.end <= mergeGapSeconds;
    if (!canMerge) {
      if (current) groups.push(current);
      current = { start: frame.start, end: frame.end, frames: [frame] };
    } else {
      current.end = Math.max(current.end, frame.end);
      current.frames.push(frame);
    }
  }
  if (current) groups.push(current);
  return groups.filter((group) => group.frames.length >= minFrames);
}

function finalizeGroup(group) {
  const rmsValues = group.frames.map((frame) => frame.rmsDb).sort((a, b) => a - b);
  const medianDb = percentile(rmsValues, 0.5);
  const meanDb = rmsValues.reduce((sum, value) => sum + value, 0) / rmsValues.length;
  const variance = rmsValues.reduce((sum, value) => sum + (value - meanDb) ** 2, 0) / rmsValues.length;
  const stationarity = clamp01(1 - Math.sqrt(variance) / 6);
  const meanFrameConfidence = group.frames.reduce((sum, frame) => sum + frame.confidence, 0) / group.frames.length;
  const humConfidence = group.frames.reduce((sum, frame) => sum + frame.humConfidence, 0) / group.frames.length;
  const strongHumFrames = group.frames.filter((frame) => frame.humConfidence >= 0.72);
  const humCoverage = strongHumFrames.length / group.frames.length;
  const frequencyVotes = new Map();
  for (const frame of strongHumFrames.length ? strongHumFrames : group.frames) {
    const weight = Math.max(0.01, frame.humConfidence);
    frequencyVotes.set(frame.humFrequencyHz, (frequencyVotes.get(frame.humFrequencyHz) || 0) + weight);
  }
  const humFrequencyHz = [...frequencyVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const noiseKind = humConfidence >= 0.58 || humCoverage >= 0.4 ? 'hum' : 'broadband';
  const levelIntensity = clamp01((medianDb + 68) / 36);
  return {
    start: roundMillis(group.start),
    end: roundMillis(group.end),
    intensity: roundHundredth(levelIntensity),
    confidence: roundHundredth(clamp01(0.66 * meanFrameConfidence + 0.34 * stationarity)),
    noiseKind,
    rmsDb: roundTenth(medianDb),
    stationarity: roundHundredth(stationarity),
    humConfidence: roundHundredth(humConfidence),
    humCoverage: roundHundredth(humCoverage),
    ...(noiseKind === 'hum' && humFrequencyHz ? { frequencyHz: humFrequencyHz } : {}),
  };
}

function overlapsVoicedPitch(start, end, contour) {
  return (Array.isArray(contour) ? contour : []).some((point) => {
    if (!point?.voiced || (Number(point.confidence) || 0) < 0.35) return false;
    const time = Number(point.time);
    return Number.isFinite(time) && time >= start - 0.02 && time <= end + 0.02;
  });
}

function overlapsAny(start, end, events, padding = 0) {
  return (Array.isArray(events) ? events : []).some((event) => {
    const eventStart = Number(event?.start ?? event?.startSeconds ?? event?.time);
    const eventEnd = Number(event?.end ?? event?.endSeconds ?? event?.time);
    if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= eventStart) return false;
    return Math.min(end + padding, eventEnd + padding) > Math.max(start - padding, eventStart - padding);
  });
}

function goertzelPower(samples, start, frameSize, sampleRate, frequencyHz) {
  if (!(frequencyHz > 0) || frequencyHz >= sampleRate / 2) return 0;
  const omega = 2 * Math.PI * frequencyHz / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0; let s1 = 0; let s2 = 0;
  for (let index = 0; index < frameSize; index += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, frameSize - 1));
    const value = (Number(samples[start + index]) || 0) * window;
    s0 = value + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : null;
}
function amplitudeToDb(value) {
  return 20 * Math.log10(Math.max(1e-9, Number(value) || 0));
}
function percentile(values, p) {
  if (!values.length) return -120;
  const index = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * p)));
  return values[index];
}
function smoothStep(edge0, edge1, value) {
  const t = clamp01((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function roundMillis(value) { return Math.round((Number(value) || 0) * 1000) / 1000; }
function roundHundredth(value) { return Math.round((Number(value) || 0) * 100) / 100; }
function roundTenth(value) { return Math.round((Number(value) || 0) * 10) / 10; }
