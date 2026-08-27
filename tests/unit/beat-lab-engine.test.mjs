import test from 'node:test';
import assert from 'node:assert/strict';

import {
  activeBeatStepCount,
  beatPatternDurationSeconds,
  createBeatLabState,
  duplicateBeatPattern,
  generateBeatFill,
  refreshBeatLanesFromSampler,
  sequenceBeatEvents,
  setBeatBpm,
  setBeatGrooveAmount,
  setBeatHumanize,
  setBeatStepCount,
  setBeatStepVelocity,
  setBeatSwing,
  toggleBeatStep,
} from '../../packages/app/beat-lab-engine.mjs';

const sampler = {
  sourceAssetId: 'asset_1',
  grooveTemplate: {
    ready: true,
    bpm: 120,
    confidence: 0.75,
    stepsPerBar: 16,
    offsetsBeats: [0, 0.05, 0, 0.05, 0, 0.05, 0, 0.05, 0, 0.05, 0, 0.05, 0, 0.05, 0, 0.05],
    accents: [1, 0.5, 0.8, 0.5, 1, 0.5, 0.8, 0.5, 1, 0.5, 0.8, 0.5, 1, 0.5, 0.8, 0.5],
  },
  pads: [
    { id: 'pad_2', sourceAssetId: 'asset_1', label: 'Pad 2', start: 0.2, end: 0.45, category: 'snare', categoryConfidence: 0.8 },
    { id: 'pad_1', sourceAssetId: 'asset_1', label: 'Pad 1', start: 0, end: 0.2, category: 'kick', categoryConfidence: 0.9 },
    { id: 'pad_3', sourceAssetId: 'asset_1', label: 'Pad 3', start: 0.45, end: 0.55, category: 'closed_hat', categoryConfidence: 0.75 },
  ],
};

test('creates semantic lanes from persistent sampler pads', () => {
  const state = createBeatLabState(sampler, { bpm: 100 });
  assert.equal(state.schema, 'pablovoice_beat_lab_v2');
  assert.equal(state.bpm, 100);
  assert.equal(state.stepCount, 16);
  assert.equal(state.lanes.length, 3);
  assert.equal(state.lanes[0].padId, 'pad_1');
  assert.equal(state.lanes[0].category, 'kick');
  assert.equal(state.lanes[1].padId, 'pad_2');
  assert.equal(state.lanes[2].category, 'closed_hat');
});

test('toggle and velocity produce deterministic playback events', () => {
  let state = createBeatLabState(sampler, { bpm: 120 });
  const kickLane = state.lanes.find((lane) => lane.category === 'kick');
  const snareLane = state.lanes.find((lane) => lane.category === 'snare');
  state = toggleBeatStep(state, kickLane.id, 0);
  state = toggleBeatStep(state, snareLane.id, 4);
  state = setBeatStepVelocity(state, snareLane.id, 4, 90);
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
  const lane = state.lanes[0];
  state = toggleBeatStep(state, lane.id, 0);
  state = toggleBeatStep(state, lane.id, 1);
  state = setBeatSwing(state, 1);
  const events = sequenceBeatEvents(state);
  assert.equal(events[0].timeSeconds, 0);
  assert.equal(events[1].beat, 0.375);
  assert.equal(events[1].timeSeconds, 0.1875);
});

test('reference groove adds evidence-backed timing offset and humanize remains deterministic', () => {
  let state = createBeatLabState(sampler, { bpm: 120 });
  const lane = state.lanes[0];
  state = toggleBeatStep(state, lane.id, 1);
  state = setBeatGrooveAmount(state, 1);
  let events = sequenceBeatEvents(state);
  assert.ok(Math.abs(events[0].timing.grooveOffsetBeats - 0.05) < 1e-9);
  assert.ok(Math.abs(events[0].beat - 0.3) < 1e-9);
  state = setBeatHumanize(state, 1);
  const a = sequenceBeatEvents(state);
  const b = sequenceBeatEvents(state);
  assert.deepEqual(a, b);
  assert.notEqual(a[0].timing.humanizeOffsetBeats, 0);
});

test('semantic fill targets a percussive lane near the end of the pattern', () => {
  let state = createBeatLabState(sampler, { bpm: 120 });
  state = generateBeatFill(state, { intensity: 0.65 });
  assert.equal(state.lastOperation?.ok, true);
  assert.equal(state.lastOperation?.category, 'snare');
  const lane = state.lanes.find((item) => item.id === state.lastOperation.laneId);
  assert.equal(lane.steps[12].active, true);
  assert.equal(lane.steps[14].active, true);
  assert.equal(lane.steps[15].active, true);
});

test('lane reorganization preserves existing pattern by pad identity', () => {
  let state = createBeatLabState({ ...sampler, pads: [...sampler.pads].reverse() }, { bpm: 120 });
  const snare = state.lanes.find((lane) => lane.padId === 'pad_2');
  state = toggleBeatStep(state, snare.id, 6);
  state = refreshBeatLanesFromSampler(state, sampler);
  const refreshed = state.lanes.find((lane) => lane.padId === 'pad_2');
  assert.equal(refreshed.steps[6].active, true);
});

test('pattern length, bpm and duplicate stay bounded and reusable', () => {
  let state = createBeatLabState(sampler, { bpm: 120, stepCount: 8 });
  const lane = state.lanes[0];
  state = toggleBeatStep(state, lane.id, 0);
  state = toggleBeatStep(state, lane.id, 7);
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
