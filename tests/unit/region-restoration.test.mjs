import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyVocalRestorationInPlace,
  normalizeVocalDenoiseEvent,
  normalizeVocalDereverbEvent,
  regionalVocalDenoiseEvents,
  regionalVocalDereverbEvents,
} from '../../packages/audio/src/automation/region-restoration.mjs';

const SAMPLE_RATE = 16000;

function deterministicNoise(length, amplitude = 0.008) {
  const samples = new Float32Array(length);
  let random = 0x87654321;
  for (let index = 0; index < length; index += 1) {
    random = (1664525 * random + 1013904223) >>> 0;
    samples[index] = (((random / 0xffffffff) * 2) - 1) * amplitude;
  }
  return samples;
}

function rms(samples, startSeconds, endSeconds) {
  const start = Math.floor(startSeconds * SAMPLE_RATE);
  const end = Math.min(samples.length, Math.floor(endSeconds * SAMPLE_RATE));
  let squares = 0;
  for (let index = start; index < end; index += 1) squares += samples[index] ** 2;
  return Math.sqrt(squares / Math.max(1, end - start));
}

function dbRatio(after, before) { return 20 * Math.log10(Math.max(1e-12, after) / Math.max(1e-12, before)); }

test('downward denoise reduces only below the measured floor while preserving active vocal level', () => {
  const samples = deterministicNoise(SAMPLE_RATE * 2);
  for (let index = Math.floor(0.4 * SAMPLE_RATE); index < Math.floor(1.45 * SAMPLE_RATE); index += 1) {
    const time = index / SAMPLE_RATE;
    samples[index] += 0.16 * Math.sin(2 * Math.PI * 220 * time) + 0.05 * Math.sin(2 * Math.PI * 700 * time);
  }
  const before = new Float32Array(samples);
  const event = normalizeVocalDenoiseEvent({
    kind: 'vocal_denoise', startSeconds: 0, endSeconds: 2, thresholdDb: -32, reductionDb: 5.5,
    attackSeconds: 0.008, releaseSeconds: 0.12, noiseFloorDb: -42, voicedLevelDb: -16,
    snrDb: 26, voicedMarginDb: 16, confidence: 0.9, timbreProtected: true,
    guardSource: 'bounded-vocal-timbre-guard-v1',
  });
  applyVocalRestorationInPlace(samples, { sampleRate: SAMPLE_RATE, denoise: [event] });
  const quietReductionDb = dbRatio(rms(samples, 0.15, 0.32), rms(before, 0.15, 0.32));
  const vocalDeltaDb = dbRatio(rms(samples, 0.65, 1.2), rms(before, 0.65, 1.2));
  assert.ok(quietReductionDb <= -3.5, `quiet reduction was ${quietReductionDb.toFixed(2)} dB`);
  assert.ok(Math.abs(vocalDeltaDb) <= 0.2, `active vocal moved ${vocalDeltaDb.toFixed(2)} dB`);
});

test('inverse early-reflection filter moves reverberant PCM closer to the dry voice', () => {
  const length = SAMPLE_RATE * 2;
  const dry = new Float32Array(length);
  let random = 0x13572468;
  for (const at of [0.25, 0.62, 1.02, 1.38]) {
    const start = Math.floor(at * SAMPLE_RATE);
    for (let offset = 0; offset < Math.floor(0.12 * SAMPLE_RATE); offset += 1) {
      random = (1664525 * random + 1013904223) >>> 0;
      const noise = ((random / 0xffffffff) * 2) - 1;
      dry[start + offset] += noise * 0.2 * Math.exp(-offset / (0.035 * SAMPLE_RATE));
    }
  }
  const delay = Math.round(0.036 * SAMPLE_RATE);
  const wet = new Float32Array(dry);
  for (let index = delay; index < wet.length; index += 1) wet[index] += 0.16 * dry[index - delay];
  const processed = new Float32Array(wet);
  const event = normalizeVocalDereverbEvent({
    kind: 'vocal_dereverb', startSeconds: 0.1, endSeconds: 1.9, reflectionDelayMs: 36,
    amount: 0.16, dampingHz: 6500, correlation: 0.62, prominence: 0.18,
    confidence: 0.9, timbreProtected: true, guardSource: 'bounded-vocal-timbre-guard-v1',
  });
  applyVocalRestorationInPlace(processed, { sampleRate: SAMPLE_RATE, dereverb: [event] });
  const wetError = differenceRms(wet, dry, 0.2, 1.85);
  const processedError = differenceRms(processed, dry, 0.2, 1.85);
  assert.ok(processedError < wetError * 0.72, `error ratio was ${(processedError / wetError).toFixed(3)}`);
});

test('unsafe or unprotected restoration events are rejected before DSP', () => {
  const unsafeNoise = normalizeVocalDenoiseEvent({ kind: 'vocal_denoise', startSeconds: 0, endSeconds: 1, thresholdDb: -24, voicedLevelDb: -18, reductionDb: 20, confidence: 1, timbreProtected: true });
  assert.equal(unsafeNoise.reductionDb, 5.5);
  assert.equal(unsafeNoise.timbreProtected, false);
  const unsafeRoom = normalizeVocalDereverbEvent({ kind: 'vocal_dereverb', startSeconds: 0, endSeconds: 1, reflectionDelayMs: 2, amount: 0.9, confidence: 1, timbreProtected: false });
  assert.equal(unsafeRoom.reflectionDelayMs, 18);
  assert.equal(unsafeRoom.amount, 0.2);
  assert.equal(unsafeRoom.timbreProtected, false);
  assert.equal(regionalVocalDenoiseEvents([unsafeNoise]).length, 0);
  assert.equal(regionalVocalDereverbEvents([unsafeRoom]).length, 0);

  const forgedRoom = normalizeVocalDereverbEvent({
    kind: 'vocal_dereverb', startSeconds: 0, endSeconds: 1, reflectionDelayMs: 180,
    amount: 0.15, correlation: 0.6, prominence: 0.2, confidence: 1, timbreProtected: true,
    guardSource: 'bounded-vocal-timbre-guard-v1',
  });
  assert.equal(forgedRoom.reflectionDelayMs, 90);
  assert.equal(forgedRoom.timbreProtected, false);
  assert.equal(regionalVocalDereverbEvents([forgedRoom]).length, 0);
});

function differenceRms(left, right, startSeconds, endSeconds) {
  const start = Math.floor(startSeconds * SAMPLE_RATE);
  const end = Math.min(left.length, right.length, Math.floor(endSeconds * SAMPLE_RATE));
  let squares = 0;
  for (let index = start; index < end; index += 1) squares += (left[index] - right[index]) ** 2;
  return Math.sqrt(squares / Math.max(1, end - start));
}
