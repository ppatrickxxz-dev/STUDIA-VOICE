import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceRegionToTrackTime, sourceRegionToTimeline, sourceRegionsToTrackTime } from '../../packages/audio/src/automation/region-time.mjs';

test('source region maps through trim and track offset', () => {
  const track = { trimStart: 2, offset: 5, effects: { pitchSemitones: 0 } };
  const region = { startSeconds: 3, endSeconds: 3.5 };
  assert.deepEqual(sourceRegionToTrackTime(track, region), { start: 1, end: 1.5 });
  assert.deepEqual(sourceRegionToTimeline(track, region), { start: 6, end: 6.5 });
});

test('source region respects pitch playback rate', () => {
  const track = { trimStart: 1, offset: 0, effects: { pitchSemitones: 12 } };
  const region = { startSeconds: 3, endSeconds: 5 };
  assert.deepEqual(sourceRegionToTrackTime(track, region), { start: 1, end: 2 });
});

test('mapping preserves event metadata while replacing time coordinates', () => {
  const track = { trimStart: 1, effects: { pitchSemitones: 0 } };
  const mapped = sourceRegionsToTrackTime(track, [{ id: 'breath', startSeconds: 1.25, endSeconds: 1.5, gainDb: -6 }]);
  assert.deepEqual(mapped, [{ id: 'breath', startSeconds: 0.25, endSeconds: 0.5, gainDb: -6 }]);
});
