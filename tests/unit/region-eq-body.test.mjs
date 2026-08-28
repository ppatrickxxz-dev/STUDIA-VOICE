import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePeakingEqEvent,
  peakingEqAutomationPoints,
  regionalPeakingEqEvents,
} from '../../packages/audio/src/automation/region-eq.mjs';

test('regional peaking EQ clamps frequency Q and ignores unrelated events', () => {
  const events = [
    { kind: 'peaking_eq', startSeconds: 1, endSeconds: 2, gainDb: 30, frequencyHz: 20, q: 20, enabled: true },
    { kind: 'high_shelf', startSeconds: 1, endSeconds: 2, gainDb: 2, frequencyHz: 6500, enabled: true },
    { kind: 'peaking_eq', startSeconds: 3, endSeconds: 4, gainDb: 2, frequencyHz: 220, q: 0.82, enabled: false },
  ];
  const selected = regionalPeakingEqEvents(events, 0, 5);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].gainDb, 12);
  assert.equal(selected[0].frequencyHz, 80);
  assert.equal(selected[0].q, 6);
});

test('seeking inside a peaking EQ region starts at regional gain and returns to neutral', () => {
  const event = normalizePeakingEqEvent({
    kind: 'peaking_eq', startSeconds: 1, endSeconds: 3, gainDb: 1.5, frequencyHz: 220, q: 0.82,
  });
  const points = peakingEqAutomationPoints(event, 2, 4);
  assert.deepEqual(points[0], { time: 2, value: 1.5 });
  assert.equal(points.at(-1).time, 3);
  assert.equal(points.at(-1).value, 0);
});
