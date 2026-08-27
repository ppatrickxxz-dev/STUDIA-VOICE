import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeTempo } from '../../packages/audio/src/analyzers/tempo.mjs';

test('tempo analyzer accepts timeSeconds emitted by the onset analyzer', () => {
  const onsets = Array.from({ length: 8 }, (_, index) => ({ timeSeconds: index * 0.5, confidence: 0.9 }));
  const result = analyzeTempo(onsets, { durationSeconds: 4 });
  assert.ok(Math.abs(result.bpm - 120) < 0.001);
  assert.equal(result.confidence, 1);
  assert.ok(result.beats.length >= 8);
});

test('tempo analyzer keeps compatibility with numeric and legacy time fields', () => {
  assert.equal(Math.round(analyzeTempo([0, 0.5, 1, 1.5]).bpm), 120);
  assert.equal(Math.round(analyzeTempo([{ time: 0 }, { time: 0.5 }, { time: 1 }]).bpm), 120);
});
