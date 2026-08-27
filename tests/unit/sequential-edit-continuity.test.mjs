import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createTrack } from '../../packages/core/src/project.mjs';
import { executeNaturalLanguageEditSequence } from '../../packages/core/src/natural-language-edit.mjs';

const COMMANDS = [
  'Deixa minha voz mais limpa, sem mexer no fim.',
  'Deixa ela mais presente e centraliza.',
  'Coloca um fade bem curto no começo, sem mexer no fim.',
];

function fixture() {
  const project = createProject('B11');
  project.lyrics = 'Letra congelada para continuidade.';
  project.notes = 'Não alterar.';
  project.preset = 'music';

  const voice = createTrack({ name: 'Voz', assetId: 'asset_voice', duration: 184.96, sampleRate: 48000, channels: 1, kind: 'recording' });
  voice.trimStart = 1.25;
  voice.trimEnd = 181.5;
  voice.gain = 0.92;
  voice.pan = -0.3;
  voice.effects.fadeOut = 0.8;
  voice.effects.clean = false;
  voice.effects.presence = false;

  const instrumental = createTrack({ name: 'Instrumental', assetId: 'asset_instrumental', duration: 184.96, sampleRate: 48000, channels: 2, kind: 'audio' });
  instrumental.gain = 0.88;
  instrumental.pan = 0.12;
  instrumental.effects.warm = true;

  project.tracks.push(voice, instrumental);
  project.activeTrackId = voice.id;
  return { project, voiceId: voice.id, instrumentalId: instrumental.id };
}

test('B11 applies three sequential edits without structural or non-selected-track drift', () => {
  const { project, voiceId, instrumentalId } = fixture();
  const instrumentalBefore = structuredClone(project.tracks.find((track) => track.id === instrumentalId));
  const projectIdentityBefore = {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    lyrics: project.lyrics,
    notes: project.notes,
    preset: project.preset,
    trackOrder: project.tracks.map((track) => track.id),
  };

  const result = executeNaturalLanguageEditSequence(project, COMMANDS, { trackId: voiceId, now: 5000 });
  const voice = result.project.tracks.find((track) => track.id === voiceId);
  const instrumentalAfter = result.project.tracks.find((track) => track.id === instrumentalId);

  assert.equal(result.steps.length, 3);
  assert.deepEqual(result.steps.map((step) => step.applied_operations.map(({ type, key, value }) => ({ type, key, value }))), [
    [{ type: 'set_effect', key: 'clean', value: true }],
    [
      { type: 'set_effect', key: 'presence', value: true },
      { type: 'set_track', key: 'pan', value: 0 },
    ],
    [{ type: 'set_effect', key: 'fadeIn', value: 0.25 }],
  ]);

  assert.equal(voice.effects.clean, true);
  assert.equal(voice.effects.presence, true);
  assert.equal(voice.pan, 0);
  assert.equal(voice.effects.fadeIn, 0.25);
  assert.equal(voice.trimStart, 1.25);
  assert.equal(voice.trimEnd, 181.5);
  assert.equal(voice.gain, 0.92);
  assert.equal(voice.effects.fadeOut, 0.8);
  assert.deepEqual(instrumentalAfter, instrumentalBefore);
  assert.deepEqual({
    id: result.project.id,
    name: result.project.name,
    createdAt: result.project.createdAt,
    lyrics: result.project.lyrics,
    notes: result.project.notes,
    preset: result.project.preset,
    trackOrder: result.project.tracks.map((track) => track.id),
  }, projectIdentityBefore);
  assert.deepEqual(result.continuity, {
    structural_identity_preserved: true,
    other_tracks_preserved: true,
    selected_track_source_identity_preserved: true,
    trim_and_timeline_preserved: true,
  });
});

test('B11 sequence fails closed when any intermediate conversational edit is unsupported', () => {
  const { project, voiceId } = fixture();
  assert.throws(
    () => executeNaturalLanguageEditSequence(project, [COMMANDS[0], 'Troca tudo por uma orquestra.', COMMANDS[2]], { trackId: voiceId }),
    /Nenhuma operação segura/,
  );
});
