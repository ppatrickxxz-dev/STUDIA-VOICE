import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../packages/app/song-creation-studio.mjs', import.meta.url), 'utf8');

test('Creator HQ mode is wired to PabloVoice native GPU client', () => {
  assert.match(source, /import \{ NativeMusicGenerationClient \} from '\.\/native-music-generation-client\.mjs'/);
  assert.match(source, /new NativeMusicGenerationClient\(\)/);
  assert.doesNotMatch(source, /new MusicGenerationClient\(\)/);
  assert.match(source, /PabloVoice · Alta qualidade/);
  assert.match(source, /data-song-create-hq>✦ Criar música/);
  assert.match(source, /runCreation\(event\.target, 'hq'\)/);
});

test('instrumental-first maps to a true provider instrumental request without deleting project lyrics', () => {
  assert.match(source, /const explicitInstrumental = Boolean\(form\.elements\.instrumentalFirst\?\.checked\)/);
  assert.match(source, /resolveSongCreationLyrics\(\{ lyrics, instrumentalFirst: true \}\)/);
  assert.match(source, /lyrics: lyricMode\.planLyrics/);
  assert.match(source, /instrumental: explicitInstrumental/);
  assert.match(source, /const finalLyrics = explicitInstrumental \? lyricMode\.projectLyrics/);
});

test('native render persistence records proof identity and never labels generic vocal mix as isolated instrumental', () => {
  assert.match(source, /source: highQuality\.source \|\| 'pablovoice_native_music_v2_1'/);
  assert.match(source, /providerModelRevision: highQuality\.modelRevision/);
  assert.match(source, /remoteSha256: highQuality\.sha256/);
  assert.match(source, /role: 'reference_mix'/);
  assert.match(source, /Música de referência criada com direção de produção e estrutura do prompt/);
  assert.doesNotMatch(source, /source: 'elevenmusic_music_v2'/);
});
