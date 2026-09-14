import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../packages/app/song-creation-studio.mjs', import.meta.url), 'utf8');

test('professional song-first Creator is wired only to PabloVoice native GPU client', () => {
  assert.match(source, /import \{ NativeMusicGenerationClient \} from '\.\/native-music-generation-client\.mjs'/);
  assert.match(source, /new NativeMusicGenerationClient\(\)/);
  assert.doesNotMatch(source, /new MusicGenerationClient\(\)/);
  assert.doesNotMatch(source, /song-creation-engine\.mjs/);
  assert.match(source, /PABLOVOICE · CRIAR/);
  assert.match(source, /data-song-create-hq>✦ Criar 2 versões/);
  assert.match(source, /await runCreation\(event\.target\)/);
  assert.match(source, /professionalCandidates: DEFAULT_CANDIDATES/);
  assert.match(source, /localToyFallback: false/);
});

test('instrumental mode is explicit, reaches the native provider and never deletes project lyrics', () => {
  assert.match(source, /const instrumental = Boolean\(form\.elements\.instrumentalFirst\?\.checked\)/);
  assert.match(source, /collectCreationRequest\(form, \{ brief, lyrics, instrumental \}\)/);
  assert.match(source, /instrumental,/);
  assert.match(source, /project\.lyrics = lyrics/);
  assert.match(source, /lyricsSnapshot: String\(lyrics \|\| ''\)\.slice\(0, 16000\)/);
  assert.match(source, /kind: instrumental \? 'ai_music_instrumental' : 'ai_music_song'/);
});

test('generated alternatives are persisted but never auto-selected or promoted before explicit user approval', () => {
  assert.match(source, /autoSelectGeneratedCandidate: false/);
  assert.match(source, /latestGeneratedTakeId: takeId/);
  assert.match(source, /latestTakeId: project\.songCreation\?\.latestTakeId \|\| null/);
  assert.doesNotMatch(source, /await selectCandidate\(project, first\.takeId, first\.trackId/);
  assert.doesNotMatch(source, /project\.activeTrackId = activeTrackId/);
  assert.match(source, /const selection = await selectCandidate\(project, choose\.dataset\.takeId, choose\.dataset\.trackId\)/);
  assert.match(source, /latestApprovedAt: Date\.now\(\)/);
});

test('vocal candidates require acoustic presence verification before selection', () => {
  assert.match(source, /vocalContentAudit !== 'acoustic_presence_verified'/);
  assert.match(source, /code: 'vocal_audit_required'/);
  assert.match(source, /vocalPending \? 'Aguardando confirmação vocal'/);
  assert.match(source, /vocalSuccessRequiresAcousticAudit: true/);
});

test('native render persistence records verified remote identity and never labels the full mix as an isolated instrumental stem', () => {
  assert.match(source, /source: highQuality\.source \|\| 'pablovoice_native_music_v2_3'/);
  assert.match(source, /providerModelRevision: highQuality\.modelRevision \|\| null/);
  assert.match(source, /remoteSha256: highQuality\.sha256 \|\| remoteAsset\.sha256 \|\| null/);
  assert.match(source, /role: 'reference_mix'/);
  assert.match(source, /purpose: instrumental \? 'professional_instrumental_candidate' : 'professional_vocal_song_candidate'/);
  assert.doesNotMatch(source, /source: 'elevenmusic_music_v2'/);
});
