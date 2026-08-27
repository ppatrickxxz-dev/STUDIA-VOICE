import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBreathAndSibilance } from '../../packages/audio/src/analyzers/breath-sibilance.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

const sampleRate = 16000;

function seededNoise(length, { smoothing = 0, amplitude = 0.05, seed = 1234567 } = {}) {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  let previous = 0;
  for (let i = 0; i < length; i += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const raw = ((state / 0xffffffff) * 2 - 1) * amplitude;
    previous = smoothing * previous + (1 - smoothing) * raw;
    out[i] = previous;
  }
  return out;
}

function sine(length, frequency = 180, amplitude = 0.12) {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
  return out;
}

test('smoothed broadband noise produces a breath event without becoming dominant sibilance', () => {
  const samples = seededNoise(sampleRate * 0.6, { smoothing: 0.72, amplitude: 0.08 });
  const result = detectBreathAndSibilance(samples, { sampleRate, frameSize: 512, hopSize: 256 });
  assert.ok(result.breathEvents.length >= 1, 'expected at least one breath event');
  assert.ok(result.breathEvents[0].confidence >= 0.56);
  assert.ok(result.breathEvents[0].end > result.breathEvents[0].start);
  assert.ok(result.breathEvents.length >= result.sibilanceEvents.length);
});

test('fast unsmoothed noise is separated as sibilance-like energy', () => {
  const samples = seededNoise(sampleRate * 0.45, { smoothing: 0, amplitude: 0.07, seed: 99 });
  const result = detectBreathAndSibilance(samples, { sampleRate, frameSize: 512, hopSize: 256 });
  assert.ok(result.sibilanceEvents.length >= 1, 'expected at least one sibilance event');
  assert.ok(result.sibilanceEvents[0].confidence >= 0.62);
});

test('stable voiced sine is not classified as breath or sibilance', () => {
  const samples = sine(sampleRate * 0.5);
  const result = detectBreathAndSibilance(samples, { sampleRate, frameSize: 512, hopSize: 256 });
  assert.equal(result.breathEvents.length, 0);
  assert.equal(result.sibilanceEvents.length, 0);
});

test('shared pipeline auto-detects events but respects explicitly provided event arrays', () => {
  const samples = seededNoise(sampleRate * 0.5, { smoothing: 0.72, amplitude: 0.08 });
  const detected = analyzeMusicalAudio({ samples, sampleRate, pitchOptions: { frameSize: 512, hopSize: 512 } });
  assert.equal(detected.voice.eventDetection.source, 'local-heuristic-v1');
  assert.ok(detected.voice.eventDetection.breathCount >= 1);

  const provided = analyzeMusicalAudio({
    samples,
    sampleRate,
    breathEvents: [],
    sibilanceEvents: [],
    pitchOptions: { frameSize: 512, hopSize: 512 },
  });
  assert.equal(provided.voice.eventDetection.source, 'provided');
  assert.equal(provided.voice.breathEvents.length, 0);
  assert.equal(provided.voice.sibilanceEvents.length, 0);
});
