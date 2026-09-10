import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInstrumentTiming,
  encodePcmWav,
  listInstrumentPresets,
  normalizeInstrumentState,
  renderInstrumentPcm,
} from '../../packages/app/instrument-engine.mjs';

test('Instrument Lab exposes a broader honest local synth palette', () => {
  const presets = listInstrumentPresets();
  assert.ok(presets.length >= 8);
  assert.ok(presets.some((item) => item.id === 'velvet_ep' && item.family === 'Keys'));
  assert.ok(presets.some((item) => item.id === 'sub_bass' && item.family === 'Bass'));
  assert.ok(presets.some((item) => item.id === 'synth_lead' && item.family === 'Lead'));
  assert.equal(new Set(presets.map((item) => item.id)).size, presets.length);
  assert.equal(normalizeInstrumentState({ preset: 'bass' }).preset, 'synth_bass');
});

test('quantize and swing change timing deterministically without mutating source notes', () => {
  const source = {
    bpm: 112,
    quantize: '1/8',
    swing: .2,
    notes: [
      { midi: 60, velocity: 100, start_beat: .27, duration_beats: .43 },
      { midi: 64, velocity: 96, start_beat: .76, duration_beats: .49 },
    ],
  };
  const scheduled = applyInstrumentTiming(source);
  assert.equal(scheduled[0].start_beat, .6);
  assert.equal(scheduled[0].duration_beats, .5);
  assert.equal(scheduled[1].start_beat, 1);
  assert.equal(scheduled[1].duration_beats, .5);
  assert.equal(source.notes[0].start_beat, .27);
});

test('local instrument renderer creates non-silent stereo PCM and a valid WAV blob', () => {
  const rendered = renderInstrumentPcm({
    preset: 'velvet_ep',
    bpm: 120,
    quantize: '1/16',
    swing: .12,
    notes: [
      { midi: 60, velocity: 104, start_beat: 0, duration_beats: 1 },
      { midi: 64, velocity: 96, start_beat: .5, duration_beats: 1 },
      { midi: 67, velocity: 100, start_beat: 1, duration_beats: 1 },
    ],
  }, { sampleRate: 22050, channels: 2 });
  assert.equal(rendered.channels.length, 2);
  assert.equal(rendered.channels[0].length, rendered.frameCount);
  assert.ok(rendered.channels[0].some((value) => Math.abs(value) > .0001));
  assert.ok(rendered.duration > 1);
  const wav = encodePcmWav(rendered);
  assert.equal(wav.type, 'audio/wav');
  assert.ok(wav.size > 44);
});

test('new performance controls stay bounded for saved projects', () => {
  const state = normalizeInstrumentState({ octave: 99, swing: 9, quantize: 'broken', bpm: 999 });
  assert.equal(state.octave, 2);
  assert.equal(state.swing, .45);
  assert.equal(state.quantize, '1/8');
  assert.equal(state.bpm, 240);
});
