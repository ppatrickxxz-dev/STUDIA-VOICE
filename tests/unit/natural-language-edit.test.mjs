import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { executeNaturalLanguageEdit, interpretNaturalLanguageEdit } from '../../packages/core/src/natural-language-edit.mjs';

const COMMAND = 'Deixa minha voz mais limpa e presente, centraliza ela e coloca um fade bem curto no começo, sem mexer no fim.';

function fixture() {
  const project = createProject('B10');
  const track = createTrack({ name: 'Voz', assetId: 'asset_voice', duration: 120, sampleRate: 48000, channels: 1, kind: 'recording' });
  track.trimStart = 1.5;
  track.trimEnd = 118.25;
  track.effects.fadeOut = 0.7;
  track.pan = -0.35;
  track.effects.presence = false;
  track.effects.fadeIn = 0;
  project.tracks.push(track);
  project.activeTrackId = track.id;
  return { project, trackId: track.id };
}

test('B10 frozen PT-BR command maps to exact safe operations', () => {
  const intent = interpretNaturalLanguageEdit(COMMAND);
  assert.equal(intent.supported, true);
  assert.deepEqual(intent.operations.map(({ type, key, value }) => ({ type, key, value })), [
    { type: 'set_effect', key: 'clean', value: true },
    { type: 'set_effect', key: 'presence', value: true },
    { type: 'set_track', key: 'pan', value: 0 },
    { type: 'set_effect', key: 'fadeIn', value: 0.25 },
  ]);
  assert.deepEqual(intent.preserved.sort(), ['fadeOut', 'trimEnd']);
});

test('B10 executor applies requested edit and preserves forbidden regions', () => {
  const { project, trackId } = fixture();
  const result = executeNaturalLanguageEdit(project, COMMAND, { trackId, now: 123456 });
  const track = result.project.tracks.find((item) => item.id === trackId);
  assert.equal(track.effects.clean, true);
  assert.equal(track.effects.presence, true);
  assert.equal(track.pan, 0);
  assert.equal(track.effects.fadeIn, 0.25);
  assert.equal(track.trimEnd, 118.25);
  assert.equal(track.effects.fadeOut, 0.7);
  assert.equal(result.project.updatedAt, 123456);
});

test('unsupported conversational edits fail closed instead of inventing actions', () => {
  const intent = interpretNaturalLanguageEdit('Transforma isso numa orquestra sinfônica e troca minha voz por outra pessoa.');
  assert.equal(intent.supported, false);
  assert.deepEqual(intent.operations, []);
  const { project } = fixture();
  assert.throws(() => executeNaturalLanguageEdit(project, 'Faz qualquer coisa incrível aí.'), /Nenhuma operação segura/);
});
