export const AUDIO_ANALYSIS_SCHEMA_VERSION = 1;
export const AUDIO_ANALYSIS_ENGINE = 'pablovoice.analysis.local-v1';

export function analyzeAudioBuffer(buffer, options = {}) {
  validateBuffer(buffer);
  const sampleRate = Number(buffer.sampleRate);
  const channels = Number(buffer.numberOfChannels);
  const frames = Number(buffer.length);
  const duration = frames / sampleRate;
  const clipThreshold = finite(options.clipThreshold, 0.999);
  const silenceThresholdDb = finite(options.silenceThresholdDb, -50);
  const windowMs = clamp(finite(options.windowMs, 50), 10, 1000);
  const windowFrames = Math.max(1, Math.round(sampleRate * windowMs / 1000));

  let sumSquares = 0;
  let peak = 0;
  let clippedSamples = 0;
  let sampleCount = 0;
  const windowRms = [];

  for (let start = 0; start < frames; start += windowFrames) {
    const end = Math.min(frames, start + windowFrames);
    let windowSquares = 0;
    let windowSamples = 0;

    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = start; index < end; index += 1) {
        const sample = finite(data[index], 0);
        const abs = Math.abs(sample);
        peak = Math.max(peak, abs);
        if (abs >= clipThreshold) clippedSamples += 1;
        const square = sample * sample;
        sumSquares += square;
        windowSquares += square;
        sampleCount += 1;
        windowSamples += 1;
      }
    }

    windowRms.push(windowSamples ? Math.sqrt(windowSquares / windowSamples) : 0);
  }

  const rms = sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0;
  const peakDbFS = linearToDb(peak);
  const rmsDbFS = linearToDb(rms);
  const windowDb = windowRms.map(linearToDb);
  const activeWindows = windowDb.filter((value) => value > silenceThresholdDb);
  const silentWindows = windowDb.length - activeWindows.length;
  const p10 = percentile(activeWindows, 0.10);
  const p95 = percentile(activeWindows, 0.95);
  const dynamicRangeDb = activeWindows.length >= 2 ? Math.max(0, p95 - p10) : 0;

  return {
    schemaVersion: AUDIO_ANALYSIS_SCHEMA_VERSION,
    engine: AUDIO_ANALYSIS_ENGINE,
    measuredAt: options.measuredAt ?? Date.now(),
    provenance: {
      kind: 'measured',
      input: 'decoded_pcm',
      algorithm: 'deterministic-local-dsp',
    },
    source: {
      sampleRate,
      channels,
      frames,
      durationSeconds: round(duration, 6),
    },
    measurements: {
      peakLinear: round(peak, 8),
      peakDbFS: round(peakDbFS, 4),
      rmsLinear: round(rms, 8),
      rmsDbFS: round(rmsDbFS, 4),
      loudnessProxyDbFS: round(rmsDbFS, 4),
      crestFactorDb: round(peakDbFS - rmsDbFS, 4),
      clippingSampleRatio: round(sampleCount ? clippedSamples / sampleCount : 0, 8),
      clippedSamples,
      silenceWindowRatio: round(windowDb.length ? silentWindows / windowDb.length : 1, 8),
      dynamicRangeDb: round(dynamicRangeDb, 4),
      analysisWindowMs: windowMs,
      silenceThresholdDb,
      clipThreshold,
    },
    unavailable: {
      bpm: 'ENGINE_NOT_CONFIGURED',
      beatPositions: 'ENGINE_NOT_CONFIGURED',
      downbeats: 'ENGINE_NOT_CONFIGURED',
      musicalKey: 'ENGINE_NOT_CONFIGURED',
      pitchContour: 'ENGINE_NOT_CONFIGURED',
      onsets: 'ENGINE_NOT_CONFIGURED',
      transients: 'ENGINE_NOT_CONFIGURED',
      sections: 'ENGINE_NOT_CONFIGURED',
      snrDb: 'ENGINE_NOT_CONFIGURED',
      sibilance: 'ENGINE_NOT_CONFIGURED',
      roomReverb: 'ENGINE_NOT_CONFIGURED',
    },
  };
}

export function analysisIsMeasured(result) {
  return Boolean(result && result.schemaVersion === AUDIO_ANALYSIS_SCHEMA_VERSION && result.provenance?.kind === 'measured');
}

function validateBuffer(buffer) {
  if (!buffer || typeof buffer.getChannelData !== 'function') throw new TypeError('AudioBuffer inválido para análise.');
  if (!Number.isFinite(Number(buffer.sampleRate)) || Number(buffer.sampleRate) <= 0) throw new TypeError('Sample rate inválido.');
  if (!Number.isInteger(Number(buffer.numberOfChannels)) || Number(buffer.numberOfChannels) <= 0) throw new TypeError('Número de canais inválido.');
  if (!Number.isInteger(Number(buffer.length)) || Number(buffer.length) < 0) throw new TypeError('Comprimento de áudio inválido.');
  for (let channel = 0; channel < Number(buffer.numberOfChannels); channel += 1) {
    const data = buffer.getChannelData(channel);
    if (!data || data.length < Number(buffer.length)) throw new TypeError(`Canal ${channel} incompleto.`);
  }
}

function percentile(values, quantile) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * clamp(quantile, 0, 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function linearToDb(value) {
  const number = Math.max(0, finite(value, 0));
  return number > 0 ? 20 * Math.log10(number) : -120;
}

function round(value, digits = 4) {
  if (!Number.isFinite(value)) return value < 0 ? -120 : 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
