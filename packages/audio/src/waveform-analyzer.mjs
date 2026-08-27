const EPSILON = 1e-12;

export function analyzeWaveform(buffer, options = {}) {
  if (!buffer || typeof buffer.numberOfChannels !== 'number' || typeof buffer.getChannelData !== 'function') {
    throw new TypeError('AudioBuffer-like input is required.');
  }

  const silenceDb = Number.isFinite(options.silenceDb) ? options.silenceDb : -55;
  const clipThreshold = Number.isFinite(options.clipThreshold) ? Math.abs(options.clipThreshold) : 0.999;
  const frameMs = Number.isFinite(options.frameMs) ? Math.max(5, options.frameMs) : 20;
  const sampleRate = Number(buffer.sampleRate) || 48000;
  const length = Number(buffer.length) || buffer.getChannelData(0)?.length || 0;
  const channels = Math.max(1, Number(buffer.numberOfChannels) || 1);
  const frameSize = Math.max(1, Math.round(sampleRate * frameMs / 1000));

  let absolutePeak = 0;
  let sumSquares = 0;
  let sampleCount = 0;
  let clippedSamples = 0;
  const frameRms = [];

  for (let offset = 0; offset < length; offset += frameSize) {
    const end = Math.min(length, offset + frameSize);
    let frameSquares = 0;
    let frameSamples = 0;

    for (let channel = 0; channel < channels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let index = offset; index < end; index += 1) {
        const sample = Number(data[index] || 0);
        const abs = Math.abs(sample);
        if (abs > absolutePeak) absolutePeak = abs;
        if (abs >= clipThreshold) clippedSamples += 1;
        const square = sample * sample;
        sumSquares += square;
        frameSquares += square;
        sampleCount += 1;
        frameSamples += 1;
      }
    }

    const rms = Math.sqrt(frameSquares / Math.max(1, frameSamples));
    frameRms.push(rms);
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, sampleCount));
  const rmsDbfs = amplitudeToDb(rms);
  const peakDbfs = amplitudeToDb(absolutePeak);
  const silenceThreshold = dbToAmplitude(silenceDb);
  const silentFrames = frameRms.filter((value) => value <= silenceThreshold).length;
  const sorted = [...frameRms].sort((a, b) => a - b);
  const p10 = percentile(sorted, 0.10);
  const p95 = percentile(sorted, 0.95);
  const dynamicRangeDb = Math.max(0, amplitudeToDb(Math.max(p95, EPSILON)) - amplitudeToDb(Math.max(p10, EPSILON)));

  return {
    analyzer: {
      id: 'pablovoice.waveform.v1',
      kind: 'deterministic_waveform',
      version: 1,
    },
    measured: {
      durationSeconds: length / sampleRate,
      sampleRate,
      channels,
      absolutePeak,
      peakDbfs,
      rms,
      rmsDbfs,
      clippedSamples,
      clippingRatio: clippedSamples / Math.max(1, sampleCount),
      silenceRatio: silentFrames / Math.max(1, frameRms.length),
      dynamicRangeDb,
    },
    confidence: {
      peak: 1,
      rms: 1,
      clipping: 1,
      silence: 0.9,
      dynamicRange: 0.75,
    },
    notMeasured: ['bpm', 'beats', 'downbeats', 'key', 'pitchContour', 'onsets', 'transients', 'snr', 'sibilance', 'roomReverb', 'breaths', 'sections'],
    provenance: {
      source: 'decoded_pcm',
      sampleCount,
      frameMs,
      silenceDb,
      clipThreshold,
    },
  };
}

export function amplitudeToDb(value) {
  const amplitude = Math.max(EPSILON, Math.abs(Number(value) || 0));
  return 20 * Math.log10(amplitude);
}

export function dbToAmplitude(db) {
  return 10 ** (Number(db) / 20);
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}
