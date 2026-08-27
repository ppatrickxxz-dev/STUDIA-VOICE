import test from 'node:test';
import assert from 'node:assert/strict';
import { midiToHz, normalizeInstrumentState, renderInstrumentPcm } from '../packages/app/instrument-engine.mjs';

test('midiToHz resolves A4', () => {
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
});

test('instrument state clamps bpm and sanitizes notes', () => {
  const state = normalizeInstrumentState({ bpm: 500, preset: 'missing', notes: [{ midi: 60.4, velocity: 200, start_beat: -2, duration_beats: 0 }] });
  assert.equal(state.bpm, 240);
  assert.equal(state.preset, 'warm_keys');
  assert.deepEqual(state.notes[0], { midi: 60, velocity: 127, start_beat: 0, duration_beats: 0.25 });
});

test('renderInstrumentPcm produces finite stereo PCM', () => {
  const result = renderInstrumentPcm({ bpm: 120, preset: 'warm_keys', notes: [{ midi: 60, velocity: 100, start_beat: 0, duration_beats: 1 }] }, { sampleRate: 24000, channels: 2 });
  assert.equal(result.channels.length, 2);
  assert.equal(result.sampleRate, 24000);
  assert.ok(result.duration > 0.5);
  assert.ok(result.frameCount > 12000);
  assert.ok(result.channels[0].some((value) => Math.abs(value) > 0.0001));
  assert.ok(result.channels[0].every(Number.isFinite));
});

test('renderInstrumentPcm rejects empty sequences', () => {
  assert.throws(() => renderInstrumentPcm({ notes: [] }), /Grave algumas notas/);
});
