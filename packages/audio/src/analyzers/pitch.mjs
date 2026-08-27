const DEFAULT_FRAME_SIZE = 2048;
const DEFAULT_HOP_SIZE = 256;

export function hzToMidi(hz) {
  if (!Number.isFinite(hz) || hz <= 0) return null;
  return 69 + 12 * Math.log2(hz / 440);
}

export function midiToNoteName(midi) {
  if (!Number.isFinite(midi)) return null;
  const rounded = Math.round(midi);
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const octave = Math.floor(rounded / 12) - 1;
  return `${names[((rounded % 12) + 12) % 12]}${octave}`;
}

export function analyzePitch(samples, sampleRate, { frameSize = DEFAULT_FRAME_SIZE, hopSize = DEFAULT_HOP_SIZE, minHz = 65, maxHz = 1200, rmsGate = 0.01 } = {}) {
  if (!samples?.length || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { pitchContour: [], noteEvents: [], voicedRatio: 0, confidence: 0 };
  }
  const contour = [];
  for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
    const frame = samples.subarray ? samples.subarray(offset, offset + frameSize) : samples.slice(offset, offset + frameSize);
    const rms = Math.sqrt(frame.reduce((sum, x) => sum + x * x, 0) / frame.length);
    const time = offset / sampleRate;
    if (rms < rmsGate) {
      contour.push({ time, hz: null, midi: null, note: null, voiced: false, confidence: 0 });
      continue;
    }
    const result = autocorrelationPitch(frame, sampleRate, minHz, maxHz);
    const midi = hzToMidi(result.hz);
    contour.push({ time, hz: result.hz, midi, note: midiToNoteName(midi), voiced: Boolean(result.hz), confidence: result.confidence });
  }
  const voiced = contour.filter((point) => point.voiced);
  return {
    pitchContour: contour,
    noteEvents: contourToNoteEvents(contour, hopSize / sampleRate),
    voicedRatio: contour.length ? voiced.length / contour.length : 0,
    confidence: voiced.length ? voiced.reduce((sum, point) => sum + point.confidence, 0) / voiced.length : 0
  };
}

function autocorrelationPitch(frame, sampleRate, minHz, maxHz) {
  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / minHz));
  let bestLag = 0;
  let best = -Infinity;
  let energy = 0;
  for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
  if (!energy) return { hz: null, confidence: 0 };
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    let lagEnergy = 0;
    for (let i = 0; i < frame.length - lag; i++) {
      corr += frame[i] * frame[i + lag];
      lagEnergy += frame[i + lag] * frame[i + lag];
    }
    const normalized = lagEnergy ? corr / Math.sqrt(energy * lagEnergy) : 0;
    if (normalized > best) {
      best = normalized;
      bestLag = lag;
    }
  }
  if (best < 0.35 || !bestLag) return { hz: null, confidence: Math.max(0, best) };
  return { hz: sampleRate / bestLag, confidence: Math.min(1, Math.max(0, best)) };
}

function contourToNoteEvents(contour, frameDuration) {
  const events = [];
  let current = null;
  for (const point of contour) {
    const midi = point.voiced && Number.isFinite(point.midi) ? Math.round(point.midi) : null;
    if (midi === null) {
      if (current) {
        current.end = point.time;
        events.push(current);
        current = null;
      }
      continue;
    }
    if (!current || current.midi !== midi) {
      if (current) {
        current.end = point.time;
        events.push(current);
      }
      current = { start: point.time, end: point.time + frameDuration, midi, note: midiToNoteName(midi), confidence: point.confidence, frames: 1 };
    } else {
      current.end = point.time + frameDuration;
      current.frames += 1;
      current.confidence = ((current.confidence * (current.frames - 1)) + point.confidence) / current.frames;
    }
  }
  if (current) events.push(current);
  return events.map(({ frames, ...event }) => event);
}
