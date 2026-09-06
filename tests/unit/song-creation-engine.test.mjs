import test from 'node:test';
import assert from 'node:assert/strict';
import { createSongCreationPlan, renderSongCreation, SONG_CREATION_SCHEMA, describeSongPlan } from '../../packages/app/song-creation-engine.mjs';

test('plans a structured song with editable guide timing', () => {
  const plan = createSongCreationPlan({ brief: 'R&B pop íntimo', lyrics: 'Eu chego perto\nVocê não foge\nHoje é só nós\nAmanhã a gente vê', genre: 'rnb', bpm: 112, durationSeconds: 60, key: 'A' });
  assert.equal(plan.schema, SONG_CREATION_SCHEMA);
  assert.equal(plan.bpm, 112);
  assert.equal(plan.key, 'A');
  assert.ok(plan.sections.length >= 6);
  assert.ok(plan.padNotes.length > 0);
  assert.ok(plan.bassNotes.length > 0);
  assert.ok(plan.drumEvents.length > 0);
  assert.ok(plan.guideNotes.length >= 12);
  assert.equal(plan.guideLines[0].text, 'Eu chego perto');
  assert.ok(plan.sections.every((section, index, list) => index === 0 || section.startBeat === list[index - 1].endBeat));
  assert.match(describeSongPlan(plan), /112 BPM/);
});

test('renders non-empty WAV stems with bounded duration', () => {
  const plan = createSongCreationPlan({ brief: 'pop demo', lyrics: 'linha um\nlinha dois', genre: 'pop', bpm: 120, durationSeconds: 30, key: 'C' });
  const rendered = renderSongCreation(plan, { sampleRate: 22050 });
  assert.equal(rendered.sampleRate, 22050);
  assert.ok(rendered.instrumental.blob.size > 44);
  assert.ok(rendered.guide.blob.size > 44);
  assert.equal(rendered.instrumental.rendered.channels.length, 1);
  assert.equal(rendered.guide.rendered.channels.length, 1);
  const inst = rendered.instrumental.rendered.channels[0];
  const guide = rendered.guide.rendered.channels[0];
  assert.ok(inst.some((sample) => Math.abs(sample) > 0.0001));
  assert.ok(guide.some((sample) => Math.abs(sample) > 0.0001));
});
