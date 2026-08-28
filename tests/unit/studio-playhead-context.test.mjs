import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clearStudioPlayhead,
  readStudioPlayhead,
  recordStudioPlayhead,
  studioPlayheadMaxAgeMs,
} from '../../packages/app/studio-playhead-context.mjs';

test('playhead records positive project-scoped positions with millisecond precision', () => {
  clearStudioPlayhead();
  const record = recordStudioPlayhead('p1', 12.3456, 1000);
  assert.deepEqual(record, { projectId: 'p1', seconds: 12.346, capturedAt: 1000 });
  const read = readStudioPlayhead('p1', { now: 1200 });
  assert.equal(read.ok, true);
  assert.equal(read.seconds, 12.346);
  assert.equal(read.ageMs, 200);
});

test('zero, negative, missing project and another project never reuse playhead evidence', () => {
  clearStudioPlayhead();
  assert.equal(recordStudioPlayhead('p1', 0, 1000), null);
  assert.equal(recordStudioPlayhead('p1', -1, 1000), null);
  assert.equal(recordStudioPlayhead('', 3, 1000), null);
  recordStudioPlayhead('p1', 3.2, 1000);
  assert.equal(readStudioPlayhead('p2', { now: 1100 }).ok, false);
  assert.equal(readStudioPlayhead('p2', { now: 1100 }).reason, 'playhead_missing');
});

test('stale playhead fails closed', () => {
  clearStudioPlayhead();
  recordStudioPlayhead('p1', 8, 1000);
  const result = readStudioPlayhead('p1', { now: 1000 + studioPlayheadMaxAgeMs() + 1 });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'playhead_stale');
});

test('clearing one project does not erase another project', () => {
  clearStudioPlayhead();
  recordStudioPlayhead('p1', 2, 1000);
  recordStudioPlayhead('p2', 4, 1000);
  assert.equal(clearStudioPlayhead('p1'), true);
  assert.equal(readStudioPlayhead('p1', { now: 1100 }).ok, false);
  assert.equal(readStudioPlayhead('p2', { now: 1100 }).seconds, 4);
});
