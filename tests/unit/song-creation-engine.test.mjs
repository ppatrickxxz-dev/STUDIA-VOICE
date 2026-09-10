import test from 'node:test';
import assert from 'node:assert/strict';
import { createSongCreationPlan, renderSongCreation, SONG_CREATION_SCHEMA, describeSongPlan } from '../../packages/app/song-creation-engine.mjs';
import { createArrangementMap, normalizeSectionKind, upsertConfirmedSection } from '../../packages/core/src/section-map.mjs';

test('plans a structured song with editable guide timing', () => {
  const plan = createSongCreationPlan({ brief: 'R&B pop íntimo', lyrics: 'Eu chego perto\nVocê não foge\nHoje é só nós\nAmanhã a gente vê', genre: 'rnb', bpm: 112, durationSeconds: 60, key: 'A', seed: 101 });
  assert.equal(plan.schema, SONG_CREATION_SCHEMA);
  assert.equal(plan.bpm, 112);
  assert.equal(plan.key, 'A');
  assert.equal(plan.seed, 101);
  assert.match(plan.variationId, /^v[0-9a-f]{8}$/);
  assert.ok(plan.creativeProfile?.groove);
  assert.ok(plan.creativeProfile?.palette?.pad);
  assert.ok(plan.sections.length >= 6);
  assert.ok(plan.padNotes.length > 0);
  assert.ok(plan.bassNotes.length > 0);
  assert.ok(plan.drumEvents.length > 0);
  assert.ok(plan.guideNotes.length >= 12);
  assert.equal(plan.guideLines[0].text, 'Eu chego perto');
  assert.ok(plan.sections.every((section, index, list) => index === 0 || section.startBeat === list[index - 1].endBeat));
  assert.match(describeSongPlan(plan), /112 BPM/);
});

test('new takes receive different creative profiles while a frozen seed reproduces the same plan decisions', () => {
  const input = { brief: 'R&B anos 2000 com funk melody', lyrics: 'Hoje eu quero você\nAmanhã a gente vê', genre: 'rnb', bpm: 112, durationSeconds: 60, key: 'A' };
  const first = createSongCreationPlan(input);
  const second = createSongCreationPlan(input);
  assert.notEqual(first.seed, second.seed);
  assert.notEqual(first.variationId, second.variationId);

  const frozenA = createSongCreationPlan({ ...input, seed: 424242 });
  const frozenB = createSongCreationPlan({ ...input, seed: 424242 });
  assert.equal(frozenA.seed, frozenB.seed);
  assert.deepEqual(frozenA.progression, frozenB.progression);
  assert.deepEqual(frozenA.creativeProfile, frozenB.creativeProfile);
  assert.deepEqual(frozenA.drumEvents, frozenB.drumEvents);
  assert.deepEqual(frozenA.guideNotes, frozenB.guideNotes);
});

test('different frozen seeds alter more than incidental noise', () => {
  const input = { brief: 'R&B sensual moderno', lyrics: 'Linha um\nLinha dois', genre: 'rnb', bpm: 100, durationSeconds: 48, key: 'C' };
  const a = createSongCreationPlan({ ...input, seed: 11 });
  const b = createSongCreationPlan({ ...input, seed: 987654 });
  const fingerprintA = JSON.stringify({ progression: a.progression, profile: a.creativeProfile, bass: a.bassNotes.slice(0, 8), guide: a.guideNotes.slice(0, 8) });
  const fingerprintB = JSON.stringify({ progression: b.progression, profile: b.creativeProfile, bass: b.bassNotes.slice(0, 8), guide: b.guideNotes.slice(0, 8) });
  assert.notEqual(fingerprintA, fingerprintB);
});

test('canonical pre-chorus kind survives section-map normalization and insertion', () => {
  assert.equal(normalizeSectionKind('pre_chorus'), 'pre_chorus');
  const map = upsertConfirmedSection(createArrangementMap(1), {
    kind: 'pre_chorus',
    startSeconds: 8,
    endSeconds: 16,
    source: 'song_creation_runtime_v1',
    confidence: 1,
  });
  assert.equal(map.sections.length, 1);
  assert.equal(map.sections[0].kind, 'pre_chorus');
  assert.equal(map.sections[0].startSeconds, 8);
  assert.equal(map.sections[0].endSeconds, 16);
});

test('renders non-empty WAV stems with bounded duration', () => {
  const plan = createSongCreationPlan({ brief: 'pop demo', lyrics: 'linha um\nlinha dois', genre: 'pop', bpm: 120, durationSeconds: 30, key: 'C', seed: 77 });
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
