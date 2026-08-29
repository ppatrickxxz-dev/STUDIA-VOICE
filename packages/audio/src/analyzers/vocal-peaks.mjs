export function detectVocalPeaks(samples, {
  sampleRate = 48000,
  frameSize = 512,
  hopSize = 128,
  minRms = 0.01,
  minPeak = 0.09,
  riseThreshold = 1.75,
  confidenceThreshold = 0.66,
  baselineRelease = 0.96,
  mergeGapSeconds = 0.035,
  maxEventSeconds = 0.18,
} = {}) {
  if (!samples || typeof samples.length !== 'number' || samples.length < frameSize) return { peakEvents: [], frames: [] };
  const frames = [];
  let baselineRms = null;
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const feature = frameLevel(samples, start, frameSize);
    const baseline = baselineRms == null ? feature.rms : Math.max(0.002, baselineRms);
    const rise = baselineRms == null ? 1 : feature.rms / baseline;
    const riseScore = smoothStep(riseThreshold, 3.4, rise);
    const peakScore = smoothStep(minPeak, 0.55, feature.peak);
    const crestScore = smoothStep(1.8, 4.5, feature.crestFactor);
    const confidence = feature.rms >= minRms && feature.peak >= minPeak
      ? clamp01(0.5 * riseScore + 0.3 * peakScore + 0.2 * crestScore)
      : 0;
    const label = confidence >= confidenceThreshold ? 'peak' : 'other';
    frames.push({
      start: start / sampleRate,
      end: (start + frameSize) / sampleRate,
      label,
      confidence,
      rms: feature.rms,
      peak: feature.peak,
      crestFactor: feature.crestFactor,
      transientRise: rise,
    });
    baselineRms = baselineRms == null
      ? feature.rms
      : feature.rms < baselineRms
        ? baselineRelease * baselineRms + (1 - baselineRelease) * feature.rms
        : 0.72 * baselineRms + 0.28 * feature.rms;
  }
  return { peakEvents: mergePeakFrames(frames, { mergeGapSeconds, maxEventSeconds }), frames };
}

function frameLevel(samples, start, frameSize) {
  let sumSquares = 0;
  let peak = 0;
  for (let index = 0; index < frameSize; index += 1) {
    const value = Number(samples[start + index]) || 0;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
  }
  const rms = Math.sqrt(sumSquares / frameSize);
  const crestFactor = rms > 1e-9 ? peak / rms : 0;
  return { rms, peak, crestFactor };
}

function mergePeakFrames(frames, { mergeGapSeconds, maxEventSeconds }) {
  const selected = frames.filter((frame) => frame.label === 'peak');
  if (!selected.length) return [];
  const events = [];
  let current = null;
  for (const frame of selected) {
    const merge = current
      && frame.start - current.end <= mergeGapSeconds
      && frame.end - current.start <= maxEventSeconds;
    if (!merge) {
      if (current) events.push(finalize(current));
      current = {
        start: frame.start,
        end: frame.end,
        confidenceSum: frame.confidence,
        peak: frame.peak,
        rms: frame.rms,
        maxRise: frame.transientRise,
        frames: 1,
      };
    } else {
      current.end = Math.max(current.end, frame.end);
      current.confidenceSum += frame.confidence;
      current.peak = Math.max(current.peak, frame.peak);
      current.rms = Math.max(current.rms, frame.rms);
      current.maxRise = Math.max(current.maxRise, frame.transientRise);
      current.frames += 1;
    }
  }
  if (current) events.push(finalize(current));
  const maxPeak = Math.max(...events.map((event) => event.peak), 1e-9);
  return events.map((event) => ({
    start: event.start,
    end: event.end,
    intensity: clamp01(event.peak / maxPeak),
    confidence: clamp01(event.confidence),
    peak: event.peak,
    rms: event.rms,
    transientRise: event.maxRise,
    source: 'vocal-peak-transient-v1',
  }));
}

function finalize(event) {
  return { ...event, confidence: event.confidenceSum / event.frames };
}
function smoothStep(edge0, edge1, value) {
  const t = clamp01((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
