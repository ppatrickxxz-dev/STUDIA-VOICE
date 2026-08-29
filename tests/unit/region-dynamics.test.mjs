import test from 'node:test';
import assert from 'node:assert/strict';
import { compressorAutomationPoints, normalizeCompressorEvent, regionalCompressorEvents } from '../../packages/audio/src/automation/region-dynamics.mjs';

const event = {
  kind: 'compressor', startSeconds: 8, endSeconds: 16,
  thresholdDb: -18, ratio: 2.2, kneeDb: 6,
  attackSeconds: 0.006, releaseSeconds: 0.12, enabled: true,
};

test('normalizes regional compressor parameters inside conservative bounds', () => {
  const normalized = normalizeCompressorEvent({ ...event, thresholdDb: -99, ratio: 20, attackSeconds: 0, releaseSeconds: 9 });
  assert.equal(normalized.thresholdDb, -36);
  assert.equal(normalized.ratio, 6);
  assert.equal(normalized.attackSeconds, 0.001);
  assert.equal(normalized.releaseSeconds, 0.8);
});

test('compressor is bypassed before and after the target region', () => {
  const points = compressorAutomationPoints(event, 0, 20, 0.02);
  assert.deepEqual(points[0], { time: 7.98, thresholdDb: 0, ratio: 1 });
  assert.deepEqual(points[1], { time: 8, thresholdDb: -18, ratio: 2.2 });
  assert.deepEqual(points.at(-1), { time: 16, thresholdDb: 0, ratio: 1 });
});

test('seek inside region starts immediately with active compression then returns to 1:1', () => {
  const points = compressorAutomationPoints(event, 10, 20, 0.02);
  assert.deepEqual(points[0], { time: 10, thresholdDb: -18, ratio: 2.2 });
  assert.deepEqual(points.at(-1), { time: 16, thresholdDb: 0, ratio: 1 });
});

test('event filtering excludes disabled and out-of-window compressors', () => {
  const events = regionalCompressorEvents([event, { ...event, enabled: false }, { ...event, startSeconds: 30, endSeconds: 40 }], 0, 20);
  assert.equal(events.length, 1);
});
