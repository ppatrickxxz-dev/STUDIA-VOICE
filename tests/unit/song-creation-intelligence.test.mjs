import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSongCreationIntelligence,
  resolveSongCreationLyrics,
  SONG_CREATION_INTELLIGENCE_SCHEMA,
} from '../../packages/app/song-creation-intelligence.mjs';

test('song creation can start from an instrumental when no lyrics exist', () => {
  const resolved = resolveSongCreationLyrics({ lyrics: '' });
  assert.equal(resolved.creationMode, 'instrumental_first');
  assert.equal(resolved.planLyrics, '');
  assert.equal(resolved.projectLyrics, '');
});

test('instrumental-first can ignore lyrics for generation without deleting project lyrics', () => {
  const resolved = resolveSongCreationLyrics({
    lyrics: 'Uma letra que deve permanecer no projeto',
    instrumentalFirst: true,
  });
  assert.equal(resolved.creationMode, 'instrumental_first');
  assert.equal(resolved.planLyrics, '');
  assert.equal(resolved.projectLyrics, 'Uma letra que deve permanecer no projeto');
});

test('lyrics-led creation sends lyrics into the plan', () => {
  const resolved = resolveSongCreationLyrics({ lyrics: 'Verso autoral', instrumentalFirst: false });
  assert.equal(resolved.creationMode, 'lyrics_led');
  assert.equal(resolved.planLyrics, 'Verso autoral');
});

test('PMI intelligence persists concept and lyric critique without rewriting source text', () => {
  const lyrics = 'Quando a cidade apaga eu vejo você\nChega mais perto, deixa acontecer\nHoje eu não prometo o que vem depois\nQuando amanhecer, amanhã a gente vê';
  const intelligence = buildSongCreationIntelligence({
    brief: 'Pop R&B noturno sobre desejo e uma noite sem promessa',
    genre: 'rnb',
    mood: 'íntimo e elegante',
    lyrics,
    creationMode: 'lyrics_led',
  });
  assert.equal(intelligence.schema, SONG_CREATION_INTELLIGENCE_SCHEMA);
  assert.equal(intelligence.engine, 'pmi-music-1.0');
  assert.equal(intelligence.creationMode, 'lyrics_led');
  assert.ok(intelligence.concept.premise.includes('Pop R&B'));
  assert.ok(intelligence.concept.directions.length >= 3);
  assert.ok(intelligence.concept.tension);
  assert.ok(intelligence.concept.payoff);
  assert.ok(intelligence.lyricCritique);
  assert.equal(typeof intelligence.lyricCritique.dimensions.meter, 'number');
  assert.equal(lyrics.includes('amanhã a gente vê'), true);
});
