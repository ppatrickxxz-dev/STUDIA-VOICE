import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSectionEndTarget } from '../../packages/core/src/section-end-target.mjs';
import { createArrangementMap, upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';

function withSection(map, kind, startSeconds, endSeconds = null) {
  return upsertConfirmedSection(map, { kind, startSeconds, endSeconds, source: 'user_manual', confidence: 1 });
}

test('section end resolution chooses the latest confirmed occurrence before the heard playhead', () => {
  let map = createArrangementMap(1);
  map = withSection(map, 'chorus', 20, 32);
  map = withSection(map, 'chorus', 60);
  const result = resolveSectionEndTarget(map, 'chorus', 72.345);
  assert.equal(result.ok, true);
  assert.equal(result.target.startSeconds, 60);
  assert.equal(result.endSeconds, 72.345);
});

test('section end resolution fails closed without a confirmed start before the playhead', () => {
  let map = createArrangementMap(1);
  map = withSection(map, 'chorus', 40);
  const result = resolveSectionEndTarget(map, 'bridge', 55);
  assert.deepEqual(result, { ok: false, reason: 'missing_confirmed_start' });
});

test('section end resolution refuses to cross another confirmed section', () => {
  let map = createArrangementMap(1);
  map = withSection(map, 'chorus', 40);
  map = withSection(map, 'verse', 52);
  const result = resolveSectionEndTarget(map, 'chorus', 60);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'crosses_confirmed_section');
  assert.equal(result.target.kind, 'chorus');
  assert.equal(result.blocker.kind, 'verse');
});

test('section end resolution rejects non-positive and before-start endpoints', () => {
  let map = createArrangementMap(1);
  map = withSection(map, 'chorus', 10);
  assert.equal(resolveSectionEndTarget(map, 'chorus', 0).ok, false);
  assert.equal(resolveSectionEndTarget(map, 'chorus', 5).reason, 'missing_confirmed_start');
});
