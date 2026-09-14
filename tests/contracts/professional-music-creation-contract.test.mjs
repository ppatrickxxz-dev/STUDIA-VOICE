import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('professional Creator produces alternatives and never renders the toy synth as the requested song', () => {
  const source = read('packages/app/song-creation-studio.mjs');
  assert.match(source, /DEFAULT_CANDIDATES\s*=\s*2/);
  assert.match(source, /createProfessionalSongPlan/);
  assert.match(source, /Criar 2 versões/);
  assert.match(source, /pending_acoustic_verification/);
  assert.doesNotMatch(source, /renderSongCreation/);
  assert.doesNotMatch(source, /guideType:\s*['"]synth_melody['"]/);
});

test('only one creation surface owns the song-first flow', () => {
  const composition = read('packages/app/composition-workspace.mjs');
  const connectivity = read('packages/app/creator-unified-runtime.mjs');
  assert.match(composition, /injectsParallelCreator:\s*false/);
  assert.match(composition, /rewritesArtistBrief:\s*false/);
  assert.match(connectivity, /injectsAlternativeCreator:\s*false/);
  assert.match(connectivity, /pendingNetworkActionsArePreserved:\s*true/);
});

test('music backend uses a professional prompt compiler and authored song structure', () => {
  const backend = read('supabase/functions/compute-kaggle-v58/index.ts');
  assert.match(backend, /professional_song_prompt_v2_3/);
  assert.match(backend, /artistRequest\(plan/);
  assert.match(backend, /aiProductionDirection\(plan,body\)/);
  assert.match(backend, /section_count/);
  assert.match(backend, /blueprint_schema/);
  assert.match(backend, /vocal_expected/);
  assert.match(backend, /lyrics_chars/);
  assert.doesNotMatch(backend, /userBrief=clean\([^\n]*,120\)/);
  assert.doesNotMatch(backend, /songDna=clean\([^\n]*,75\)/);
});
