const DEFAULT_LOW_GRID = Object.freeze([80, 100, 120, 140, 160, 180, 220, 260]);
const DEFAULT_REFERENCE_GRID = Object.freeze([320, 420, 650, 900, 1400, 2200]);

export function detectPlosives(samples, {
  sampleRate = 48000,
  frameSize = 512,
  hopSize = 128,
  minRms = 0.006,
  confidenceThreshold = 0.64,
  mergeGapSeconds = 0.025,
  maxEventSeconds = 0.14,
  refinementSeconds = 0.06,
} = {}) {
  if (!samples || typeof samples.length !== 'number' || samples.length < frameSize) return { plosiveEvents: [], frames: [] };
  const frames = [];
  let previousRms = null;
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const feature = analyzePlosiveFrame(samples, start, frameSize, sampleRate);
    const rise = previousRms == null ? 1 : feature.rms / Math.max(previousRms, 1e-6);
    const lowScore = smoothStep(0.48, 0.82, feature.lowFrequencyRatio);
    const riseScore = smoothStep(1.35, 3.2, rise);
    const crestScore = smoothStep(2.0, 5.5, feature.crestFactor);
    const zcrScore = 1 - smoothStep(0.16, 0.42, feature.zcr);
    const confidence = feature.rms >= minRms
      ? clamp01(0.38 * lowScore + 0.30 * riseScore + 0.18 * crestScore + 0.14 * zcrScore)
      : 0;
    const label = confidence >= confidenceThreshold ? 'plosive' : 'other';
    frames.push({
      start: start / sampleRate,
      end: (start + frameSize) / sampleRate,
      label,
      confidence,
      rms: feature.rms,
      peak: feature.peak,
      zcr: feature.zcr,
      lowFrequencyRatio: feature.lowFrequencyRatio,
      transientRise: rise,
      frequencyHz: feature.frequencyHz,
      spectralConfidence: feature.spectralConfidence,
    });
    previousRms = previousRms == null ? feature.rms : Math.max(feature.rms, previousRms * 0.55);
  }
  const rough = mergePlosiveFrames(frames, { mergeGapSeconds, maxEventSeconds });
  const plosiveEvents = rough.map((event) => refinePlosiveBand(event, samples, sampleRate, frameSize, refinementSeconds));
  return { plosiveEvents, frames };
}

export function analyzePlosiveFrame(samples, start, frameSize, sampleRate = 48000) {
  let sumSquares = 0;
  let peak = 0;
  let crossings = 0;
  let previous = Number(samples[start]) || 0;
  for (let i = 0; i < frameSize; i += 1) {
    const x = Number(samples[start + i]) || 0;
    sumSquares += x * x;
    peak = Math.max(peak, Math.abs(x));
    if (i > 0 && ((x >= 0) !== (previous >= 0))) crossings += 1;
    previous = x;
  }
  const rms = Math.sqrt(sumSquares / frameSize);
  const zcr = crossings / Math.max(1, frameSize - 1);
  const crestFactor = rms > 1e-9 ? peak / rms : 0;
  const spectrum = lowBandProfile(samples, start, frameSize, sampleRate);
  return { rms, peak, zcr, crestFactor, ...spectrum };
}

function refinePlosiveBand(event, samples, sampleRate, detectionFrameSize, refinementSeconds) {
  const offsetSeconds = detectionFrameSize / sampleRate / 2;
  const start = Math.max(0, Math.floor((event.start + offsetSeconds) * sampleRate));
  const wanted = Math.max(detectionFrameSize, Math.round(Math.max(0.03, Number(refinementSeconds) || 0.06) * sampleRate));
  const available = Math.max(0, samples.length - start);
  const frameSize = Math.min(wanted, available);
  if (frameSize < Math.min(128, detectionFrameSize / 2)) return event;
  const profile = lowBandProfile(samples, start, frameSize, sampleRate);
  return {
    ...event,
    frequencyHz: Math.round(profile.frequencyHz),
    spectralConfidence: profile.spectralConfidence,
    spectralSource: 'plosive-lowband-goertzel-refined-v1',
  };
}

function lowBandProfile(samples, start, frameSize, sampleRate) {
  const low = DEFAULT_LOW_GRID.map((frequencyHz) => ({ frequencyHz, power: goertzelPower(samples, start, frameSize, sampleRate, frequencyHz) }));
  const reference = DEFAULT_REFERENCE_GRID.map((frequencyHz) => ({ frequencyHz, power: goertzelPower(samples, start, frameSize, sampleRate, frequencyHz) }));
  const lowPower = low.reduce((sum, item) => sum + item.power, 0);
  const referencePower = reference.reduce((sum, item) => sum + item.power, 0);
  const lowFrequencyRatio = lowPower / Math.max(1e-12, lowPower + referencePower);
  const ranked = [...low].sort((a, b) => b.power - a.power);
  const best = ranked[0] || { frequencyHz: 140, power: 0 };
  const second = ranked[1]?.power || 0;
  const spectralConfidence = best.power > 0 ? clamp01((best.power - second) / best.power + 0.25 * lowFrequencyRatio) : 0;
  return { lowFrequencyRatio, frequencyHz: best.frequencyHz, spectralConfidence };
}

function mergePlosiveFrames(frames, { mergeGapSeconds, maxEventSeconds }) {
  const selected = frames.filter((frame) => frame.label === 'plosive');
  if (!selected.length) return [];
  const events = [];
  let current = null;
  for (const frame of selected) {
    const canMerge = current && frame.start - current.end <= mergeGapSeconds && frame.end - current.start <= maxEventSeconds;
    if (!canMerge) {
      if (current) events.push(finalize(current));
      current = {
        start: frame.start,
        end: frame.end,
        confidenceSum: frame.confidence,
        peakRms: frame.rms,
        frequencyWeighted: frame.frequencyHz * Math.max(frame.confidence, 0.01),
        frequencyWeight: Math.max(frame.confidence, 0.01),
        spectralConfidence: frame.spectralConfidence,
        frames: 1,
      };
    } else {
      current.end = Math.max(current.end, frame.end);
      current.confidenceSum += frame.confidence;
      current.peakRms = Math.max(current.peakRms, frame.rms);
      current.frequencyWeighted += frame.frequencyHz * Math.max(frame.confidence, 0.01);
      current.frequencyWeight += Math.max(frame.confidence, 0.01);
      current.spectralConfidence = Math.max(current.spectralConfidence, frame.spectralConfidence);
      current.frames += 1;
    }
  }
  if (current) events.push(finalize(current));
  const maxPeak = Math.max(...events.map((event) => event.peakRms), 1e-9);
  return events.map((event) => ({
    start: event.start,
    end: event.end,
    intensity: clamp01(event.peakRms / maxPeak),
    confidence: clamp01(event.confidence),
    frequencyHz: Math.round(event.frequencyHz),
    spectralConfidence: clamp01(event.spectralConfidence),
    spectralSource: 'plosive-lowband-goertzel-v1',
  }));
}

function finalize(event) {
  return { ...event, confidence: event.confidenceSum / event.frames, frequencyHz: event.frequencyWeighted / Math.max(event.frequencyWeight, 1e-9) };
}

function goertzelPower(samples, start, frameSize, sampleRate, frequencyHz) {
  if (!(sampleRate > 0) || !(frequencyHz > 0) || frequencyHz >= sampleRate / 2) return 0;
  const omega = 2 * Math.PI * frequencyHz / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0; let s1 = 0; let s2 = 0;
  for (let i = 0; i < frameSize; i += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, frameSize - 1));
    const x = (Number(samples[start + i]) || 0) * window;
    s0 = x + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  return Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2);
}

function smoothStep(edge0, edge1, value) {
  const t = clamp01((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
