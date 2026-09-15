import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSongCreationPlan } from '../packages/app/song-creation-engine.mjs';
import { TAO_EU_SUNO_3M20 } from './fixtures/tao-eu-suno-3m20.mjs';

const singerProfile = {
  voiceType: 'masculina',
  lowMidi: 45,
  highMidi: 67,
  language: 'pt-BR',
  tone: 'quente, low-mid, natural e próximo',
  delivery: 'conversacional, sensual, peito, sem belting e sem melisma excessivo',
  falsetto: false,
};

test('Tão Eu preserves the saved 100-bar / 3:20 arrangement', () => {
  const plan = createSongCreationPlan({
    brief: TAO_EU_SUNO_3M20.style,
    lyrics: TAO_EU_SUNO_3M20.lyrics,
    genre: TAO_EU_SUNO_3M20.genre,
    mood: TAO_EU_SUNO_3M20.mood,
    bpm: TAO_EU_SUNO_3M20.bpm,
    durationSeconds: TAO_EU_SUNO_3M20.durationSeconds,
    singerProfile,
  });

  assert.equal(plan.structuredLyrics, true);
  assert.equal(plan.totalBars, 100);
  assert.equal(plan.durationSeconds, 200);
  assert.equal(plan.sections.length, 12);
  assert.deepEqual(plan.sections.map((section) => section.bars), [4, 12, 4, 12, 4, 12, 12, 4, 16, 2, 12, 6]);
  assert.equal(plan.sections[0].label, 'Intro');
  assert.equal(plan.sections[8].label, 'Rap / Bridge');
  assert.equal(plan.sections[9].label, 'Beat Cut / Pickup');
  assert.equal(plan.sections[10].label, 'Final Chorus');
  assert.equal(plan.sections[11].endSeconds, 200);
});

test('Tão Eu keeps the exact saved lyric script in the generation plan', () => {
  const plan = createSongCreationPlan({
    brief: TAO_EU_SUNO_3M20.style,
    lyrics: TAO_EU_SUNO_3M20.lyrics,
    genre: 'pagofunk',
    bpm: 120,
    durationSeconds: 200,
    singerProfile,
  });
  assert.equal(plan.lyricsScript, TAO_EU_SUNO_3M20.lyrics);
  assert.match(plan.lyricsScript, /Jurando que já me esqueceu/);
  assert.match(plan.lyricsScript, /\[BEAT CUT — 1 bar silence \+ 1 bar pickup\]/);
  assert.match(plan.lyricsScript, /\(Levar\.\.\.\)/);
  assert.match(plan.lyricsScript, /\[OUTRO — 6 bars, intimate\]/);
});

test('native generation contract prefers the structured lyric script', async () => {
  const source = await readFile(new URL('../supabase/functions/compute-kaggle-v58/core.ts', import.meta.url), 'utf8');
  assert.match(source, /normalizeLyricsScript\(plan\?\.lyricsScript\)/);
  assert.match(source, /return'Silence'/);
  assert.match(source, /return'Bridge - low intimate rap'/);
  assert.match(source, /return'Outro - intimate'/);
  assert.match(source, /slice\(0,512\)/);
});
