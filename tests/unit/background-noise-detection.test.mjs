import test from 'node:test';
import assert from 'node:assert/strict';
import { detectBackgroundNoise } from '../../packages/audio/src/analyzers/background-noise.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

const sampleRate = 16000;

function tone(frequencyHz, amplitude = 0.012, seconds = 1.2) {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  for (let index = 0; index < out.length; index += 1) out[index] = Math.sin(2 * Math.PI * frequencyHz * index / sampleRate) * amplitude;
  return out;
}

function deterministicNoise(amplitude = 0.012, seconds = 1.2) {
  const out = new Float32Array(Math.floor(seconds * sampleRate));
  let state = 0x12345678;
  for (let index = 0; index < out.length; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    out[index] = (((state / 0xffffffff) * 2) - 1) * amplitude;
  }
  return out;
}

function voicedContour(seconds = 1.2, hopSeconds = 0.04) {
  const contour = [];
  for (let time = 0; time < seconds; time += hopSeconds) contour.push({ time, hz: 220, voiced: true, confidence: 0.95 });
  return contour;
}

function fullPipelineHum44100() {
  const sr = 44100;
  const seconds = 1.8;
  const out = new Float32Array(Math.floor(seconds * sr));
  const humWindows = [[0.42, 0.76], [1.34, 1.64]];
  for (let index = 0; index < out.length; index += 1) {
    const time = index / sr;
    let value = Math.sin(2 * Math.PI * 220 * time) * 0.025;
    for (const [start, end] of humWindows) {
      if (time < start || time > end) continue;
      const local = time - start;
      const remaining = end - time;
      const fade = Math.min(1, local / 0.035, remaining / 0.035);
      value = Math.sin(2 * Math.PI * 60 * time) * 0.014 * Math.max(0, fade);
    }
    const edge = Math.min(1, index / 500, (out.length - index) / 500);
    out[index] = Math.round(Math.max(-1, Math.min(1, value * Math.max(0, edge))) * 32767) / 32767;
  }
  return { out, sr };
}

test('stationary 60 Hz electrical hum becomes separate measured noise evidence', () => {
  const result = detectBackgroundNoise(tone(60, 0.014), { sampleRate, frameSize: 1024, hopSize: 512, minFrames: 3 });
  const hum = result.noiseEvents.find((event) => event.noiseKind === 'hum');
  assert.ok(hum, 'expected hum classification');
  assert.equal(hum.frequencyHz, 60);
  assert.ok(hum.confidence >= 0.68);
  assert.ok(hum.stationarity >= 0.8);
});

test('stationary broadband noise is reported without inventing a hum frequency', () => {
  const result = detectBackgroundNoise(deterministicNoise(0.012), { sampleRate, frameSize: 1024, hopSize: 512, minFrames: 3 });
  const event = result.noiseEvents.find((item) => item.noiseKind === 'broadband');
  assert.ok(event, 'expected broadband classification');
  assert.equal('frequencyHz' in event, false);
  assert.ok(event.stationarity >= 0.55);
});

test('silence and voiced tone are not promoted to stationary background noise', () => {
  const silence = new Float32Array(sampleRate);
  assert.equal(detectBackgroundNoise(silence, { sampleRate, frameSize: 1024, hopSize: 512, minFrames: 3 }).noiseEvents.length, 0);
  const voiced = detectBackgroundNoise(tone(220, 0.025), {
    sampleRate, frameSize: 1024, hopSize: 512, minFrames: 3, pitchContour: voicedContour(),
  });
  assert.equal(voiced.noiseEvents.length, 0);
  assert.ok(voiced.frames.some((frame) => frame.voiced));
});

test('known vocal events exclude overlapping frames from background-noise evidence', () => {
  const result = detectBackgroundNoise(deterministicNoise(0.012), {
    sampleRate, frameSize: 1024, hopSize: 512, minFrames: 3,
    excludedEvents: [{ start: 0, end: 1.2, confidence: 1 }],
  });
  assert.equal(result.noiseEvents.length, 0);
  assert.ok(result.frames.every((frame) => frame.excluded));
});

test('canonical 44.1 kHz pipeline classifies embedded hum separately from restoration evidence', () => {
  const { out, sr } = fullPipelineHum44100();
  const analysis = analyzeMusicalAudio({ samples: out, sampleRate: sr });
  const inside = analysis.voice.noiseEvents.find((event) => event.start < 0.8 && event.end > 0.4);
  assert.ok(inside, 'expected in-section stationary-noise event');
  assert.equal(inside.noiseKind, 'hum');
  assert.equal(inside.frequencyHz, 60);
  assert.equal(analysis.voice.noiseDetection.source, 'local-stationary-noise-v1');
  assert.ok(analysis.voice.restoration && Array.isArray(analysis.voice.restoration.windows));
});

test('provided stationary-noise evidence keeps provenance separate from five-family event detection and restoration', () => {
  const providedNoise = [{
    start: 0.1, end: 0.8, intensity: 0.7, confidence: 0.9, noiseKind: 'hum', frequencyHz: 60,
    rmsDb: -40, stationarity: 0.95, humConfidence: 0.9, source: 'provided-noise-gate',
  }];
  const analysis = analyzeMusicalAudio({
    samples: tone(60, 0.014), sampleRate,
    breathEvents: [], sibilanceEvents: [], plosiveEvents: [], peakEvents: [], clickEvents: [], noiseEvents: providedNoise,
    pitchOptions: { frameSize: 512, hopSize: 512, rmsGate: 1 },
  });
  assert.equal(analysis.voice.eventDetection.source, 'provided');
  assert.equal(analysis.voice.noiseDetection.source, 'provided');
  assert.equal(analysis.voice.noiseDetection.count, 1);
  assert.equal(analysis.voice.noiseEvents[0].noiseKind, 'hum');
  assert.equal(analysis.voice.noiseEvents[0].frequencyHz, 60);
  assert.equal(analysis.voice.noiseEvents[0].stationarity, 0.95);
});
