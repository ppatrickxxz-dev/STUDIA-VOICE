export function detectBreathAndSibilance(samples, {
  sampleRate = 48000,
  frameSize = 1024,
  hopSize = 512,
  minRms = 0.003,
  minEventSeconds = 0.045,
  mergeGapSeconds = 0.04,
} = {}) {
  if (!samples || typeof samples.length !== 'number' || samples.length < frameSize) {
    return { breathEvents: [], sibilanceEvents: [], frames: [] };
  }

  const frames = [];
  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    const feature = analyzeNoiseFrame(samples, start, frameSize, sampleRate);
    const active = feature.rms >= minRms;
    const breathScore = active ? scoreBreath(feature) : 0;
    const sibilanceScore = active ? scoreSibilance(feature) : 0;
    let label = 'other';
    let confidence = 0;
    if (breathScore >= 0.56 || sibilanceScore >= 0.62) {
      if (sibilanceScore > breathScore + 0.08) {
        label = 'sibilance';
        confidence = sibilanceScore;
      } else if (breathScore >= 0.56) {
        label = 'breath';
        confidence = breathScore;
      }
    }
    frames.push({
      start: start / sampleRate,
      end: (start + frameSize) / sampleRate,
      label,
      confidence: clamp01(confidence),
      rms: feature.rms,
      zcr: feature.zcr,
      highFrequencyRatio: feature.highFrequencyRatio,
      periodicity: feature.periodicity,
    });
  }

  return {
    breathEvents: mergeFrames(frames, 'breath', { minEventSeconds, mergeGapSeconds }),
    sibilanceEvents: mergeFrames(frames, 'sibilance', { minEventSeconds, mergeGapSeconds }),
    frames,
  };
}

export function analyzeNoiseFrame(samples, start, frameSize, sampleRate = 48000) {
  let sumSquares = 0;
  let diffSquares = 0;
  let crossings = 0;
  let previous = Number(samples[start]) || 0;
  let peak = Math.abs(previous);

  for (let i = 0; i < frameSize; i += 1) {
    const x = Number(samples[start + i]) || 0;
    sumSquares += x * x;
    peak = Math.max(peak, Math.abs(x));
    if (i > 0) {
      const diff = x - previous;
      diffSquares += diff * diff;
      if ((x >= 0) !== (previous >= 0)) crossings += 1;
    }
    previous = x;
  }

  const rms = Math.sqrt(sumSquares / frameSize);
  const diffRms = Math.sqrt(diffSquares / Math.max(1, frameSize - 1));
  const highFrequencyRatio = rms > 1e-9 ? clamp01(diffRms / (rms * 2)) : 0;
  const zcr = crossings / Math.max(1, frameSize - 1);
  const periodicity = normalizedPeriodicity(samples, start, frameSize, sampleRate, rms);

  return { rms, peak, zcr, highFrequencyRatio, periodicity };
}

function scoreBreath(feature) {
  const noise = 1 - feature.periodicity;
  const broadband = rangeScore(feature.highFrequencyRatio, 0.12, 0.72, 0.28, 0.58);
  const zcr = rangeScore(feature.zcr, 0.04, 0.42, 0.10, 0.30);
  const crest = feature.rms > 1e-9 ? clamp01((feature.peak / feature.rms - 1.5) / 5) : 0;
  return clamp01(0.42 * noise + 0.28 * broadband + 0.20 * zcr + 0.10 * crest);
}

function scoreSibilance(feature) {
  const noise = 1 - feature.periodicity;
  const high = smoothStep(0.42, 0.86, feature.highFrequencyRatio);
  const zcr = smoothStep(0.16, 0.48, feature.zcr);
  return clamp01(0.34 * noise + 0.38 * high + 0.28 * zcr);
}

function normalizedPeriodicity(samples, start, frameSize, sampleRate, rms) {
  if (rms < 1e-9) return 0;
  const minLag = Math.max(2, Math.floor(sampleRate / 420));
  const maxLag = Math.min(Math.floor(frameSize / 2), Math.ceil(sampleRate / 70));
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 4) {
    let cross = 0;
    let left = 0;
    let right = 0;
    const count = frameSize - lag;
    for (let i = 0; i < count; i += 2) {
      const a = Number(samples[start + i]) || 0;
      const b = Number(samples[start + i + lag]) || 0;
      cross += a * b;
      left += a * a;
      right += b * b;
    }
    const denom = Math.sqrt(left * right);
    if (denom > 1e-12) best = Math.max(best, cross / denom);
  }
  return clamp01(best);
}

function mergeFrames(frames, label, { minEventSeconds, mergeGapSeconds }) {
  const selected = frames.filter((frame) => frame.label === label);
  if (!selected.length) return [];
  const events = [];
  let current = null;
  for (const frame of selected) {
    if (!current || frame.start - current.end > mergeGapSeconds) {
      if (current) events.push(finalize(current));
      current = {
        start: frame.start,
        end: frame.end,
        confidenceSum: frame.confidence,
        intensitySum: frame.rms,
        peakRms: frame.rms,
        frames: 1,
      };
    } else {
      current.end = Math.max(current.end, frame.end);
      current.confidenceSum += frame.confidence;
      current.intensitySum += frame.rms;
      current.peakRms = Math.max(current.peakRms, frame.rms);
      current.frames += 1;
    }
  }
  if (current) events.push(finalize(current));

  const maxPeak = Math.max(...events.map((event) => event.peakRms), 1e-9);
  return events
    .filter((event) => event.end - event.start >= minEventSeconds)
    .map((event) => ({
      start: event.start,
      end: event.end,
      intensity: clamp01(event.peakRms / maxPeak),
      confidence: clamp01(event.confidence),
    }));
}

function finalize(event) {
  return {
    ...event,
    confidence: event.confidenceSum / event.frames,
    meanRms: event.intensitySum / event.frames,
  };
}

function rangeScore(value, min, max, idealMin, idealMax) {
  if (value <= min || value >= max) return 0;
  if (value >= idealMin && value <= idealMax) return 1;
  if (value < idealMin) return (value - min) / Math.max(1e-9, idealMin - min);
  return (max - value) / Math.max(1e-9, max - idealMax);
}

function smoothStep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / Math.max(1e-9, edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
