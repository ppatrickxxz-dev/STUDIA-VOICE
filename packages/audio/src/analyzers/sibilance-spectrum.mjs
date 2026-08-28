export const SIBILANCE_SPECTRUM_PROFILE = Object.freeze({
  minFrequencyHz: 4800,
  maxFrequencyHz: 10800,
  stepHz: 400,
  neighborhoodBins: 2,
  source: 'local-sibilance-spectrum-v1',
});

export function enrichSibilanceEventsWithSpectrum(samples, events = [], {
  sampleRate = 48000,
  ...options
} = {}) {
  if (!Array.isArray(events) || !events.length) return [];
  return events.map((event) => {
    const spectral = estimateSibilanceBand(samples, event, { sampleRate, ...options });
    return spectral ? { ...event, ...spectral } : { ...event };
  });
}

export function estimateSibilanceBand(samples, event = {}, {
  sampleRate = 48000,
  minFrequencyHz = SIBILANCE_SPECTRUM_PROFILE.minFrequencyHz,
  maxFrequencyHz = SIBILANCE_SPECTRUM_PROFILE.maxFrequencyHz,
  stepHz = SIBILANCE_SPECTRUM_PROFILE.stepHz,
  neighborhoodBins = SIBILANCE_SPECTRUM_PROFILE.neighborhoodBins,
} = {}) {
  if (!samples || typeof samples.length !== 'number' || samples.length < 64) return null;
  const rate = Number(sampleRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const startSeconds = Number(event?.start ?? event?.time);
  const endSeconds = Number(event?.end ?? event?.time);
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) return null;

  const start = Math.max(0, Math.floor(startSeconds * rate));
  const end = Math.min(samples.length, Math.ceil(endSeconds * rate));
  const count = end - start;
  if (count < 64) return null;

  const nyquistSafeMax = rate * 0.44;
  const minHz = Math.max(2500, Number(minFrequencyHz) || SIBILANCE_SPECTRUM_PROFILE.minFrequencyHz);
  const maxHz = Math.min(Number(maxFrequencyHz) || SIBILANCE_SPECTRUM_PROFILE.maxFrequencyHz, nyquistSafeMax);
  if (!(maxHz > minHz + 100)) return null;
  const resolvedStep = Math.max(200, Math.min(800, Number(stepHz) || SIBILANCE_SPECTRUM_PROFILE.stepHz));
  const frequencies = frequencyGrid(minHz, maxHz, resolvedStep);
  if (frequencies.length < 3) return null;

  const energies = frequencies.map((frequencyHz) => goertzelPower(samples, start, end, rate, frequencyHz));
  const totalEnergy = energies.reduce((sum, value) => sum + value, 0);
  if (!(totalEnergy > 1e-16)) return null;
  let peakIndex = 0;
  for (let index = 1; index < energies.length; index += 1) if (energies[index] > energies[peakIndex]) peakIndex = index;

  const radius = Math.max(1, Math.min(3, Math.round(Number(neighborhoodBins) || SIBILANCE_SPECTRUM_PROFILE.neighborhoodBins)));
  const first = Math.max(0, peakIndex - radius);
  const last = Math.min(energies.length - 1, peakIndex + radius);
  let localEnergy = 0;
  let weightedFrequency = 0;
  for (let index = first; index <= last; index += 1) {
    localEnergy += energies[index];
    weightedFrequency += frequencies[index] * energies[index];
  }
  if (!(localEnergy > 1e-16)) return null;
  const centerHz = weightedFrequency / localEnergy;
  let variance = 0;
  for (let index = first; index <= last; index += 1) variance += energies[index] * ((frequencies[index] - centerHz) ** 2);
  const spreadHz = Math.sqrt(Math.max(0, variance / localEnergy));

  const sorted = [...energies].sort((a, b) => a - b);
  const medianEnergy = sorted[Math.floor(sorted.length / 2)] || 0;
  const peakEnergy = energies[peakIndex];
  const contrast = clamp01((peakEnergy - medianEnergy) / Math.max(peakEnergy, 1e-16));
  const localShare = clamp01(localEnergy / totalEnergy);
  const spectralConfidence = clamp01(0.65 * contrast + 0.35 * localShare);

  return {
    frequencyHz: roundTo(centerHz, 50),
    spectralPeakHz: roundTo(frequencies[peakIndex], 50),
    spectralSpreadHz: roundTo(spreadHz, 50),
    spectralConfidence: Math.round(spectralConfidence * 100) / 100,
    spectralSource: SIBILANCE_SPECTRUM_PROFILE.source,
  };
}

function frequencyGrid(minHz, maxHz, stepHz) {
  const values = [];
  for (let frequency = minHz; frequency <= maxHz + 1e-9; frequency += stepHz) values.push(frequency);
  if (maxHz - (values.at(-1) || minHz) > stepHz / 2) values.push(maxHz);
  return values;
}

function goertzelPower(samples, start, end, sampleRate, frequencyHz) {
  const count = end - start;
  if (count < 2) return 0;
  const omega = 2 * Math.PI * frequencyHz / sampleRate;
  const coefficient = 2 * Math.cos(omega);
  let s1 = 0;
  let s2 = 0;
  for (let offset = 0; offset < count; offset += 1) {
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / Math.max(1, count - 1));
    const sample = (Number(samples[start + offset]) || 0) * window;
    const s0 = sample + coefficient * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coefficient * s1 * s2;
  return Math.max(0, power) / Math.max(1, count * count);
}

function roundTo(value, step) {
  return Math.round(Number(value) / step) * step;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}
