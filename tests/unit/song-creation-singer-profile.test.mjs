import test from 'node:test';
import assert from 'node:assert/strict';
import { createSongCreationPlan } from '../../packages/app/song-creation-engine.mjs';

test('keeps every guide note inside the configured singer range', () => {
  const plan = createSongCreationPlan({ brief: 'pop R&B', lyrics: 'Essa é a primeira frase\nEssa é a segunda frase', singerProfile: { lowMidi: 50, highMidi: 62, voiceType: 'masculina' } });
  assert.equal(plan.singerProfile.voiceType, 'masculina');
  assert.ok(plan.guideNotes.length > 0);
  assert.ok(plan.guideNotes.every((note) => note.midi >= 50 && note.midi <= 62));
});
