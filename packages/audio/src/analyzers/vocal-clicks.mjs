export function detectVocalClicks(samples, {
  sampleRate = 48000,
  frameSize = 128,
  hopSize = 32,
  minPeak = 0.035,
  minRms = 0.0018,
  confidenceThreshold = 0.68,
  maxLowFrequencyRatio = 0.58,
  mergeGapSeconds = 0.006,
  maxEventSeconds = 0.045,
  baselineRelease = 0.96,
  plosiveEvents = [],
  peakEvents = [],
} = {}) {
  if (!samples || typeof samples.length !== 'number' || samples.length < frameSize) return { clickEvents: [], frames: [] };
  const frames = [];
  let baselineRms = null;
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const feature = analyzeClickFrame(samples, start, frameSize, sampleRate);
    const baseline = baselineRms == null ? feature.rms : Math.max(0.0008, baselineRms);
    const rise = baselineRms == null ? 1 : feature.rms / baseline;
    const crestScore = smoothStep(3.2, 8.5, feature.crestFactor);
    const differenceScore = smoothStep(0.45, 1.45, feature.differenceRatio);
    const riseScore = smoothStep(1.45, 4.2, rise);
    const broadbandScore = 1 - smoothStep(0.42, maxLowFrequencyRatio, feature.lowFrequencyRatio);
    const peakScore = smoothStep(minPeak, 0.3, feature.peak);
    const confidence = feature.peak >= minPeak && feature.rms >= minRms && feature.lowFrequencyRatio <= maxLowFrequencyRatio
      ? clamp01(0.29 * crestScore + 0.27 * differenceScore + 0.2 * riseScore + 0.16 * broadbandScore + 0.08 * peakScore)
      : 0;
    frames.push({
      start: start / sampleRate,
      end: (start + frameSize) / sampleRate,
      label: confidence >= confidenceThreshold ? 'click' : 'other',
      confidence,
      peak: feature.peak,
      rms: feature.rms,
      crestFactor: feature.crestFactor,
      transientRise: rise,
      differenceRatio: feature.differenceRatio,
      lowFrequencyRatio: feature.lowFrequencyRatio,
      zcr: feature.zcr,
    });
    baselineRms = baselineRms == null
      ? feature.rms
      : feature.rms < baselineRms
        ? baselineRelease * baselineRms + (1 - baselineRelease) * feature.rms
        : 0.82 * baselineRms + 0.18 * feature.rms;
  }
  const raw = mergeClickFrames(frames, { mergeGapSeconds, maxEventSeconds });
  const plosiveRejected = raw.filter((event) => overlapsPlosive(event, plosiveEvents));
  const peakRejected = raw.filter((event) => !overlapsPlosive(event, plosiveEvents) && overlapsLargePeak(event, peakEvents));
  const clicks = raw.filter((event) => !overlapsPlosive(event, plosiveEvents) && !overlapsLargePeak(event, peakEvents));
  return {
    clickEvents: clicks.map((event) => ({ ...event, source: 'vocal-click-impulse-v1' })),
    frames,
    rejectedByPlosiveOverlap: plosiveRejected.length,
    rejectedBySustainedPeakOverlap: peakRejected.length,
  };
}

export function analyzeClickFrame(samples, start, frameSize, sampleRate = 48000) {
  let sumSquares = 0;
  let differenceSquares = 0;
  let peak = 0;
  let crossings = 0;
  let previous = Number(samples[start]) || 0;
  const frame = new Float64Array(frameSize);
  for (let index = 0; index < frameSize; index += 1) {
    const value = Number(samples[start + index]) || 0;
    frame[index] = value;
    sumSquares += value * value;
    peak = Math.max(peak, Math.abs(value));
    if (index > 0) {
      const difference = value - previous;
      differenceSquares += difference * difference;
      if ((value >= 0) !== (previous >= 0)) crossings += 1;
    }
    previous = value;
  }
  const rms = Math.sqrt(sumSquares / frameSize);
  const differenceRms = Math.sqrt(differenceSquares / Math.max(1, frameSize - 1));
  const differenceRatio = differenceRms / Math.max(rms, 1e-9);
  const crestFactor = peak / Math.max(rms, 1e-9);
  const zcr = crossings / Math.max(1, frameSize - 1);
  const lowFrequencyRatio = movingAverageLowBandRatio(frame, sampleRate);
  return { rms, differenceRms, differenceRatio, peak, crestFactor, zcr, lowFrequencyRatio };
}

function movingAverageLowBandRatio(frame, sampleRate) {
  if (!frame?.length) return 0;
  const windowSize = Math.max(5, Math.min(65, frame.length, Math.round(Number(sampleRate) / 1000) || 5));
  let running = 0;
  let lowSquares = 0;
  let totalSquares = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const value = Number(frame[index]) || 0;
    totalSquares += value * value;
    running += value;
    if (index >= windowSize) running -= Number(frame[index - windowSize]) || 0;
    const count = Math.min(index + 1, windowSize);
    const low = running / Math.max(1, count);
    lowSquares += low * low;
  }
  return clamp01(lowSquares / Math.max(totalSquares, 1e-12));
}

function mergeClickFrames(frames, { mergeGapSeconds, maxEventSeconds }) {
  const selected = frames.filter((frame) => frame.label === 'click');
  if (!selected.length) return [];
  const events = [];
  let current = null;
  for (const frame of selected) {
    const canMerge = current
      && frame.start - current.end <= mergeGapSeconds
      && frame.end - current.start <= maxEventSeconds;
    if (!canMerge) {
      if (current) events.push(finalize(current));
      current = {
        start: frame.start,
        end: frame.end,
        confidenceSum: frame.confidence,
        peak: frame.peak,
        rms: frame.rms,
        maxRise: frame.transientRise,
        differenceRatio: frame.differenceRatio,
        lowFrequencyRatio: frame.lowFrequencyRatio,
        frames: 1,
      };
    } else {
      current.end = Math.max(current.end, frame.end);
      current.confidenceSum += frame.confidence;
      current.peak = Math.max(current.peak, frame.peak);
      current.rms = Math.max(current.rms, frame.rms);
      current.maxRise = Math.max(current.maxRise, frame.transientRise);
      current.differenceRatio = Math.max(current.differenceRatio, frame.differenceRatio);
      current.lowFrequencyRatio = Math.min(current.lowFrequencyRatio, frame.lowFrequencyRatio);
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
    differenceRatio: event.differenceRatio,
    lowFrequencyRatio: event.lowFrequencyRatio,
  }));
}

function finalize(event) {
  return { ...event, confidence: event.confidenceSum / event.frames };
}

function overlapsPlosive(event, plosiveEvents) {
  return (Array.isArray(plosiveEvents) ? plosiveEvents : []).some((candidate) => overlaps(event, candidate, 0.008));
}

function overlapsLargePeak(event, peakEvents) {
  return (Array.isArray(peakEvents) ? peakEvents : []).some((candidate) => {
    const start = Number(candidate?.start ?? candidate?.time);
    const end = Number(candidate?.end ?? candidate?.time);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    const duration = end - start;
    if (duration < 0.05) return false;
    const peak = Number(candidate?.peak);
    const rms = Number(candidate?.rms);
    const crestFactor = Number.isFinite(peak) && Number.isFinite(rms) && rms > 1e-9 ? peak / rms : null;
    const sustainedShape = crestFactor == null || crestFactor < 3.2;
    if (!sustainedShape) return false;
    return overlaps(event, candidate, 0.006);
  });
}

function overlaps(a, b, padding = 0) {
  const aStart = Number(a?.start ?? a?.time);
  const aEnd = Number(a?.end ?? a?.time);
  const bStart = Number(b?.start ?? b?.time);
  const bEnd = Number(b?.end ?? b?.time);
  if (![aStart, aEnd, bStart, bEnd].every(Number.isFinite)) return false;
  return Math.min(aEnd + padding, bEnd + padding) > Math.max(aStart - padding, bStart - padding);
}

function smoothStep(edge0, edge1, value) {
  const t = clamp01((Number(value) - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
