import test from 'node:test';
import assert from 'node:assert/strict';
import {
  interpretMusicalIntent,
  respondToMusicCreation,
  routeMusicalIntent,
  upgradeSongPlanToMusicSpec,
  musicSpecProviderContext,
  MUSIC_SPEC_V2_SCHEMA,
} from '../../packages/music-intelligence/src/index.mjs';

test('musical intent translates subjective production language into bounded deltas', () => {
  const result = interpretMusicalIntent('Quero mais sensual, mais 2000, mais R&B e menos batestaca');

  assert.equal(result.supported, true);
  assert.equal(result.schema, 'pmi_musical_intent_v1');
  assert.ok(result.deltas.warmth > 0);
  assert.ok(result.deltas.syncopation > 0);
  assert.ok(result.deltas.density < 0);
  assert.ok(result.style.positive.includes('R&B'));
  assert.ok(result.style.negative.includes('batestaca'));
  assert.ok(result.style.eraHints.includes('2000s'));
});

test('bass language targets bass and asks for syncopation/humanization instead of generative replacement', () => {
  const intent = interpretMusicalIntent('Esse baixo está muito quadrado, deixa mais vivo');
  const route = routeMusicalIntent(intent);

  assert.equal(intent.supported, true);
  assert.equal(intent.scope.target, 'bass');
  assert.equal(intent.scope.preserveUnselected, true);
  assert.ok(intent.deltas.syncopation > 0);
  assert.ok(intent.deltas.humanize > 0);
  assert.ok(intent.deltas.noteVariation > 0);
  assert.equal(route.executor, 'instrument_lab');
  assert.equal(route.strategy, 'midi_first');
  assert.deepEqual(route.fallback, ['music_generation']);
  assert.equal(route.constraints.canApply, false);
});

test('localized chorus request preserves unselected material and routes to selective generation', () => {
  const intent = interpretMusicalIntent('Abre o refrão, mas sem ficar barulhento; mantém o resto');
  const route = routeMusicalIntent(intent);

  assert.equal(intent.scope.section, 'chorus');
  assert.equal(intent.scope.preserveUnselected, true);
  assert.ok(intent.deltas.energy > 0);
  assert.ok(intent.deltas.width > 0);
  assert.ok(intent.deltas.clarity > 0);
  assert.ok(intent.deltas.density < 0);
  assert.equal(route.executor, 'music_generation');
  assert.equal(route.action, 'regenerate_section');
  assert.equal(route.constraints.preserveUnselected, true);
});

test('explicit localized synth change routes to MIDI/instrument editing first', () => {
  const intent = interpretMusicalIntent('Troca só o synth e mantém o resto');
  const route = routeMusicalIntent(intent);

  assert.equal(intent.supported, true);
  assert.equal(intent.scope.target, 'synth');
  assert.equal(intent.scope.preserveUnselected, true);
  assert.equal(route.executor, 'instrument_lab');
  assert.equal(route.strategy, 'midi_first');
});

test('drum edits prefer Beat Lab before generative replacement', () => {
  const intent = interpretMusicalIntent('Ajusta só a bateria e mantém o resto');
  const route = routeMusicalIntent(intent);

  assert.equal(route.executor, 'beat_lab');
  assert.equal(route.strategy, 'deterministic_first');
  assert.deepEqual(route.fallback, ['music_generation']);
});

test('target or section nouns alone do not become fake edit plans', () => {
  assert.deepEqual(interpretMusicalIntent('o refrão'), { supported: false, reason: 'no_musical_intent' });
  assert.deepEqual(interpretMusicalIntent('baixo'), { supported: false, reason: 'no_musical_intent' });
});

test('PMI conversation exposes musical direction and chosen executor as a review-only plan', () => {
  const result = respondToMusicCreation('Abre o refrão, mas sem ficar barulhento; mantém o resto', { projectId: 'project-1' });

  assert.equal(result.supported, true);
  assert.equal(result.kind, 'pmi_musical_intent_plan');
  assert.equal(result.reviewRequired, true);
  assert.equal(result.canApply, false);
  assert.equal(result.musicalIntent.scope.section, 'chorus');
  assert.equal(result.operationRoute.executor, 'music_generation');
  assert.equal(result.operationRoute.action, 'regenerate_section');
  assert.match(result.reply, /ainda não alterei o áudio/i);
});

test('version preference is represented explicitly and routed to take history', () => {
  const intent = interpretMusicalIntent('O primeiro estava melhor, prefiro a versão anterior');
  const route = routeMusicalIntent(intent);

  assert.equal(intent.supported, true);
  assert.equal(intent.versionReference, 'prefer_previous');
  assert.equal(intent.scope.preserveUnselected, false);
  assert.equal(route.executor, 'version_history');
  assert.equal(route.action, 'preview_previous_take');
});

test('MusicSpec v2 upgrades the current song plan without dropping canonical material', () => {
  const plan = {
    schema: 'pablovoice_song_creation_v1',
    brief: 'R&B íntimo e moderno',
    genre: 'rnb',
    mood: 'sensual',
    bpm: 96,
    key: 'A',
    mode: 'minor',
    durationSeconds: 120,
    totalBars: 48,
    totalBeats: 192,
    sections: [{ id: 'verse_1', label: 'Verso 1', startBeat: 0, endBeat: 32 }],
    progression: [1, 7, 6, 7],
    padNotes: [{ midi: 60, start_beat: 0, duration_beats: 4 }],
    bassNotes: [{ midi: 36, start_beat: 0, duration_beats: 1.5 }],
    accentNotes: [],
    guideNotes: [],
    guideLines: [],
    drumEvents: [{ kind: 'kick', beat: 0, velocity: 0.95 }],
    seed: 42,
  };
  const intent = interpretMusicalIntent('Esse baixo está quadrado, deixa mais vivo');
  const spec = upgradeSongPlanToMusicSpec(plan, { intent });

  assert.equal(spec.schema, MUSIC_SPEC_V2_SCHEMA);
  assert.equal(spec.sourceSchema, 'pablovoice_song_creation_v1');
  assert.equal(spec.compatibility.preservesSongPlanFields, true);
  assert.equal(spec.compatibility.providerNeutral, true);
  assert.equal(spec.operation.target, 'bass');
  assert.equal(spec.operation.preserveUnselected, true);
  assert.deepEqual(spec.material.progression, plan.progression);
  assert.deepEqual(spec.material.bassNotes, plan.bassNotes);
  assert.deepEqual(spec.material.drumEvents, plan.drumEvents);

  const provider = musicSpecProviderContext(spec);
  assert.equal(provider.genre, 'rnb');
  assert.equal(provider.target, 'bass');
  assert.equal(provider.preserveUnselected, true);
  assert.ok(provider.deltas.humanize > 0);
});

test('unsupported prose fails closed instead of fabricating an edit', () => {
  const result = interpretMusicalIntent('Hoje eu acordei cedo e fui caminhar');
  assert.deepEqual(result, { supported: false, reason: 'no_musical_intent' });
});
