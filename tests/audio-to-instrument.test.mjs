import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioToInstrumentPlan, createSlicesFromAnalysis, mapNoteEventsToPianoRoll, createChromaticInstrumentDescriptor } from '../../packages/audio/src/sampler/audio-to-instrument.mjs';

const analysis = {
  schemaVersion: 2,
  assetId: 'asset_voice_1',
  source: { durationSeconds: 2 },
  signal: { onsets: [{ time: 0.5, confidence: 0.9 }, { time: 1.0, confidence: 0.8 }, { time: 1.5, confidence: 0.2 }] },
  music: {
    bpm: 120,
    noteEvents: [{ start: 0, end: 0.5, midi: 69, confidence: 0.95 }, { start: 0.5, end: 1, midi: 71, confidence: 0.9 }]
  },
  voice: { pitchHz: 440, pitchConfidence: 0.95, formants: [{ f1: 800, f2: 1200 }] }
};

test('slicer consumes onsets and confidence without re-analysis', () => {
  const slices = createSlicesFromAnalysis(analysis);
  assert.deepEqual(slices.map(({ start, end }) => ({ start, end })), [
    { start: 0, end: 0.5 },
    { start: 0.5, end: 1 },
    { start: 1, end: 2 }
  ]);
});

test('note events map deterministically to piano roll ticks', () => {
  const notes = mapNoteEventsToPianoRoll(analysis, { ppq: 480 });
  assert.equal(notes[0].startTick, 0);
  assert.equal(notes[0].durationTicks, 480);
  assert.equal(notes[1].startTick, 480);
});

test('chromatic descriptor is confidence gated and formant aware', () => {
  const descriptor = createChromaticInstrumentDescriptor(analysis);
  assert.equal(descriptor.ready, true);
  assert.equal(descriptor.rootMidi, 69);
  assert.equal(descriptor.preserveFormants, true);
  const low = createChromaticInstrumentDescriptor({ voice: { pitchHz: 440, pitchConfidence: 0.2 } });
  assert.equal(low.ready, false);
  assert.equal(low.reason, 'low_pitch_confidence');
});

test('audio-to-instrument plan exposes reusable sampler consumers', () => {
  const plan = buildAudioToInstrumentPlan(analysis, { ppq: 480 });
  assert.equal(plan.sourceAssetId, 'asset_voice_1');
  assert.equal(plan.slices.length, 3);
  assert.equal(plan.pianoRoll.length, 2);
  assert.equal(plan.chromatic.ready, true);
});
