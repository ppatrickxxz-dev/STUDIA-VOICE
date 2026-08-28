import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlosives } from '../../packages/audio/src/analyzers/plosive.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

const sampleRate = 16000;

function vocalWithPlosive({ seconds = 1, burstAt = 0.42, burstFrequency = 120 } = {}) {
  const length = Math.floor(seconds * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    let value = Math.sin(2 * Math.PI * 220 * t) * 0.018;
    const local = t - burstAt;
    if (local >= 0 && local <= 0.065) {
      const envelope = Math.exp(-local * 42);
      value += Math.sin(2 * Math.PI * burstFrequency * t) * 0.38 * envelope;
    }
    out[i] = value;
  }
  return out;
}

function stableLowTone(seconds = 0.8) {
  const length = Math.floor(seconds * sampleRate);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = Math.sin(2 * Math.PI * 120 * i / sampleRate) * 0.12;
  return out;
}

test('short low-frequency burst is detected as plosive evidence with measured band', () => {
  const result = detectPlosives(vocalWithPlosive(), { sampleRate, frameSize: 256, hopSize: 64 });
  assert.ok(result.plosiveEvents.length >= 1, 'expected a plosive event');
  const event = result.plosiveEvents.find((item) => item.start < 0.5 && item.end > 0.38);
  assert.ok(event, 'expected event around burst');
  assert.ok(event.confidence >= 0.64);
  assert.ok(event.frequencyHz >= 80 && event.frequencyHz <= 260);
  assert.ok(event.spectralConfidence >= 0.24);
  assert.equal(event.spectralSource, 'plosive-lowband-goertzel-v1');
});

test('steady low-frequency body does not become a plosive merely because audio starts', () => {
  const result = detectPlosives(stableLowTone(), { sampleRate, frameSize: 256, hopSize: 64 });
  assert.equal(result.plosiveEvents.length, 0);
  assert.equal(result.frames[0].transientRise, 1);
});

test('canonical musical pipeline exposes plosiveEvents and count without a second decode', () => {
  const samples = vocalWithPlosive();
  const analysis = analyzeMusicalAudio({ samples, sampleRate, pitchOptions: { frameSize: 512, hopSize: 512 }, plosiveDetectionOptions: { frameSize: 256, hopSize: 64 } });
  assert.ok(Array.isArray(analysis.voice.plosiveEvents));
  assert.ok(analysis.voice.plosiveEvents.length >= 1);
  assert.equal(analysis.voice.eventDetection.plosiveCount, analysis.voice.plosiveEvents.length);
  assert.equal(analysis.voice.eventDetection.source, 'local-heuristic-v1');
});

test('explicit plosive event arrays are preserved and bypass local plosive detection', () => {
  const samples = vocalWithPlosive();
  const provided = [{ start: 0.2, end: 0.25, intensity: 0.7, confidence: 0.9, frequencyHz: 140, spectralConfidence: 0.8, spectralSource: 'provided-gate' }];
  const analysis = analyzeMusicalAudio({
    samples,
    sampleRate,
    breathEvents: [],
    sibilanceEvents: [],
    plosiveEvents: provided,
    pitchOptions: { frameSize: 512, hopSize: 512 },
  });
  assert.equal(analysis.voice.eventDetection.source, 'provided');
  assert.equal(analysis.voice.plosiveEvents.length, 1);
  assert.equal(analysis.voice.plosiveEvents[0].frequencyHz, 140);
  assert.equal(analysis.voice.plosiveEvents[0].spectralSource, 'provided-gate');
});
