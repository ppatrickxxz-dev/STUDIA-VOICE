import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAudioPlanToInstrumentState, pianoRollPlanToInstrumentNotes, summarizeAudioPlan } from '../packages/app/audio-to-piano-roll-bridge.mjs';

test('converts tick piano roll to Instrument Lab beats', () => {
  const notes = pianoRollPlanToInstrumentNotes({ pianoRoll: [
    { midi: 60, startTick: 240, durationTicks: 480, velocity: 100, confidence: 0.8 },
  ] });
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 60);
  assert.equal(notes[0].start_beat, 0.5);
  assert.equal(notes[0].duration_beats, 1);
  assert.equal(notes[0].velocity, 100);
});

test('applies imported notes without mutating source state', () => {
  const state = { bpm: 120, notes: [{ midi: 48, start_beat: 0, duration_beats: 1, velocity: 90 }] };
  const next = applyAudioPlanToInstrumentState(state, { sourceAssetId: 'asset_1', schemaVersion: 2, pianoRoll: [
    { midi: 64, startTick: 0, durationTicks: 240, velocity: 110, confidence: 0.9 },
  ] });
  assert.equal(state.notes[0].midi, 48);
  assert.equal(next.notes[0].midi, 64);
  assert.equal(next.notes[0].duration_beats, 0.5);
  assert.equal(next.sourceAssetId, 'asset_1');
});

test('summarizes plan capabilities', () => {
  assert.deepEqual(summarizeAudioPlan({ pianoRoll: [{}, {}], slices: [{}], chromatic: { ready: true } }), {
    notes: 2,
    slices: 1,
    chromaticReady: true,
  });
});
