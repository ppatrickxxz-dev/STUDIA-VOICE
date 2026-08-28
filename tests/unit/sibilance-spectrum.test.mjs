import assert from 'node:assert/strict';
import test from 'node:test';
import {
  enrichSibilanceEventsWithSpectrum,
  estimateSibilanceBand,
  SIBILANCE_SPECTRUM_PROFILE,
} from '../../packages/audio/src/analyzers/sibilance-spectrum.mjs';

const sampleRate = 44100;

function resonantNoise(centerHz, { seconds = 0.14, seed = 0x12345678 } = {}) {
  const length = Math.floor(seconds * sampleRate);
  const out = new Float32Array(length);
  let state = seed >>> 0;
  let y1 = 0;
  let y2 = 0;
  const radius = 0.94;
  const coefficient = 2 * radius * Math.cos(2 * Math.PI * centerHz / sampleRate);
  const radiusSquared = radius * radius;
  for (let index = 0; index < length; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    const input = (state / 0xffffffff) * 2 - 1;
    const y = input + coefficient * y1 - radiusSquared * y2;
    y2 = y1;
    y1 = y;
    out[index] = y * 0.025;
  }
  return out;
}

test('spectral estimator follows the measured sibilance concentration instead of a fixed 7.2 kHz band', () => {
  const low = resonantNoise(6000, { seed: 11 });
  const high = resonantNoise(9500, { seed: 22 });
  const lowBand = estimateSibilanceBand(low, { start: 0, end: low.length / sampleRate }, { sampleRate });
  const highBand = estimateSibilanceBand(high, { start: 0, end: high.length / sampleRate }, { sampleRate });
  assert.ok(lowBand);
  assert.ok(highBand);
  assert.ok(Math.abs(lowBand.frequencyHz - 6000) < 1000, `expected low band near 6 kHz, got ${lowBand.frequencyHz}`);
  assert.ok(Math.abs(highBand.frequencyHz - 9500) < 1000, `expected high band near 9.5 kHz, got ${highBand.frequencyHz}`);
  assert.ok(highBand.frequencyHz - lowBand.frequencyHz > 2000);
  assert.ok(lowBand.spectralConfidence >= 0.12);
  assert.ok(highBand.spectralConfidence >= 0.12);
  assert.equal(lowBand.spectralSource, SIBILANCE_SPECTRUM_PROFILE.source);
  assert.equal(highBand.spectralSource, SIBILANCE_SPECTRUM_PROFILE.source);
});

test('event enrichment preserves timing/confidence and adds bounded spectral metadata', () => {
  const samples = resonantNoise(9000, { seed: 33 });
  const original = [{ start: 0.01, end: 0.12, intensity: 0.8, confidence: 0.91 }];
  const [event] = enrichSibilanceEventsWithSpectrum(samples, original, { sampleRate });
  assert.equal(event.start, original[0].start);
  assert.equal(event.end, original[0].end);
  assert.equal(event.intensity, original[0].intensity);
  assert.equal(event.confidence, original[0].confidence);
  assert.ok(event.frequencyHz >= 4800 && event.frequencyHz <= 10800);
  assert.ok(event.spectralPeakHz >= 4800 && event.spectralPeakHz <= 10800);
  assert.ok(event.spectralSpreadHz >= 0);
  assert.ok(event.spectralConfidence >= 0 && event.spectralConfidence <= 1);
});
