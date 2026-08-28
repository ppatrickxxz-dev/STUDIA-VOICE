import test from 'node:test';
import assert from 'node:assert/strict';
import { highShelfAutomationPoints, regionalHighShelfEvents } from '../../packages/audio/src/automation/region-eq.mjs';
import { regionGainEnvelope } from '../../packages/audio/src/automation/region-gain.mjs';

test('regional high shelf clamps frequency/gain and ignores disabled or unrelated events', () => {
  const events = regionalHighShelfEvents([
    { kind: 'gain', startSeconds: 1, endSeconds: 2, gainDb: 3 },
    { kind: 'high_shelf', startSeconds: 1, endSeconds: 2, gainDb: 20, frequencyHz: 99999 },
    { kind: 'high_shelf', startSeconds: 3, endSeconds: 4, gainDb: 2, frequencyHz: 6500, enabled: false },
  ], 0, 10);
  assert.equal(events.length, 1);
  assert.equal(events[0].gainDb, 12);
  assert.equal(events[0].frequencyHz, 14000);
});

test('seeking inside a high shelf region starts at the regional gain and returns to neutral at the end', () => {
  const points = highShelfAutomationPoints({
    kind: 'high_shelf', startSeconds: 4, endSeconds: 8, gainDb: 2.5, frequencyHz: 6500,
  }, 6, 12);
  assert.equal(points[0].time, 6);
  assert.equal(points[0].value, 2.5);
  assert.equal(points.at(-1).time, 8);
  assert.equal(points.at(-1).value, 0);
});

test('gain automation never treats high shelf dB as a volume gain event', () => {
  const points = regionGainEnvelope([
    { kind: 'high_shelf', startSeconds: 1, endSeconds: 2, gainDb: 4 },
  ], 0, 5);
  assert.deepEqual(points, []);
});
