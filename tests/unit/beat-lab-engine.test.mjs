import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeBeatStepCount,
  beatPatternDurationSeconds,
  createBeatLabState,
  duplicateBeatPattern,
  sequenceBeatEvents,
  setBeatBpm,
  setBeatStepCount,
  setBeatStepVelocity,
  setBeatSwing,
  toggleBeatStep,
} from '../../packages/app/beat-lab-engine.mjs';

const sampler = {
  sourceAssetId: 'asset_1',
  pads: [
    { id: 'pad_1', sourceAssetId: 'asset_1', label: 'Kick-ish', start: 0, end: 0.2 },
    { id: 'pad_2', sourceAssetId: 'asset_1', label: 'Snare-ish', start: 0.2, end: 0.45 },
  ],
};

test('creates lanes from persistent sampler pads', () => {
  const state = createBeatLabState(sampler, { bpm: 100 });
  assert.equal(state.schema, 'pablovoice_beat_lab_v1');
  assert.equal(state.bpm, 100);
  assert.equal(state.stepCount, 16);
  assert.equal(state.lanes.length, 2);
  assert.equal(state.lanes[0].padId, 'pad_1');
  assert.equal(state.lanes[1].steps.length, 16);
});

test('toggle and velocity produce deterministic playback events', () => {
  let state = createBeatLabState(sampler, { bpm: 120 });
  state = toggleBeatStep(state, 'lane_1', 0);
  state = toggleBeatStep(state, 'lane_2', 4);
  state = setBeatStepVelocity(state, 'lane_2', 4, 90);
  const events = sequenceBeatEvents(state);
  assert.equal(activeBeatStepCount(state), 2);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => [event.padId, event.stepIndex, event.velocity]), [
    ['pad_1', 0, 104],
    ['pad_2', 4, 90],
  ]);
  assert.equal(events[1].timeSeconds, 0.5);
});

test('swing delays off-grid sixteenth steps without moving straight steps', () => {
  let state = createBeatLabState(sampler, { bpm: 120 });
  state = toggleBeatStep(state, 'lane_1', 0);
  state = toggleBeatStep(state, 'lane_1', 1);
  state = setBeatSwing(state, 1);
  const events = sequenceBeatEvents(state);
  assert.equal(events[0].timeSeconds, 0);
  assert.equal(events[1].beat, 0.375);
  assert.equal(events[1].timeSeconds, 0.1875);
});

test('pattern length, bpm and duplicate stay bounded and reusable', () => {
  let state = createBeatLabState(sampler, { bpm: 120, stepCount: 8 });
  state = toggleBeatStep(state, 'lane_1', 0);
  state = toggleBeatStep(state, 'lane_1', 7);
  state = duplicateBeatPattern(state);
  assert.equal(state.stepCount, 16);
  assert.equal(state.lanes[0].steps[8].active, true);
  assert.equal(state.lanes[0].steps[15].active, true);
  state = setBeatStepCount(state, 32);
  state = setBeatBpm(state, 80);
  assert.equal(state.stepCount, 32);
  assert.equal(state.bpm, 80);
  assert.equal(beatPatternDurationSeconds(state), 6);
});
