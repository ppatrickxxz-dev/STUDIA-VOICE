import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../packages/app/song-creation-studio.mjs', import.meta.url), 'utf8');

test('Creator HQ mode is wired to PabloVoice native GPU client', () => {
  assert.match(source, /import \{ NativeMusicGenerationClient \} from '\.\/native-music-generation-client\.mjs'/);
  assert.match(source, /new NativeMusicGenerationClient\(\)/);
  assert.doesNotMatch(source, /new MusicGenerationClient\(\)/);
  assert.match(source, /Alta qualidade · PabloVoice GPU/);
  assert.match(source, /Criar com PabloVoice/);
});

test('instrumental-first maps to a true provider instrumental request without deleting project lyrics', () => {
  assert.match(source, /instrumental: lyricMode\.creationMode === 'instrumental_first'/);
  assert.match(source, /lyrics: lyricMode\.planLyrics/);
  assert.match(source, /lyricMode\.projectLyrics/);
});

test('native render persistence records proof identity and never labels generic vocal mix as isolated instrumental', () => {
  assert.match(source, /source: highQuality\.source \|\| 'pablovoice_native_music_v1'/);
  assert.match(source, /providerModelRevision: highQuality\.modelRevision/);
  assert.match(source, /remoteSha256: highQuality\.sha256/);
  assert.match(source, /role: 'reference_mix'/);
  assert.match(source, /Pode conter voz gerada; não é rotulado como instrumental isolado/);
  assert.doesNotMatch(source, /source: 'elevenmusic_music_v2'/);
});
