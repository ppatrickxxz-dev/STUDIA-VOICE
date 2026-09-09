import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Intimate Recorder canon keeps Pablo, all companions and living state system', async () => {
  const [ui, life, css, lifeCss, canon] = await Promise.all([
    read('packages/app/pablovoice-intimate-ui.mjs'),
    read('packages/app/pablo-life-ui.mjs'),
    read('packages/app/pablovoice-intimate-ui.css'),
    read('packages/app/pablo-life-ui.css'),
    read('docs/UI_CANON_LOCK.md'),
  ]);

  assert.match(ui, /\/site\/assets\/pablo_fullbody\.webp/);
  assert.match(ui, /\/site\/assets\/companions_board\.webp/);
  for (const name of ['Nota Drop', 'Star Spark', 'Wave Ribbon', 'EQ Bloom', 'Chime Lantern', 'Vinyl Groove']) {
    assert.match(ui, new RegExp(name));
    assert.match(canon, new RegExp(name));
  }
  for (const state of ['idle', 'listening', 'thinking', 'recording', 'happy', 'dancing']) {
    assert.match(ui, new RegExp(`['\"]${state}['\"]`));
  }
  for (const mode of ['vibe', 'focus', 'inspiration', 'moment']) assert.match(life, new RegExp(`id: ['\"]${mode}['\"]`));
  for (const action of ['listening', 'thinking', 'creating', 'analyzing', 'guiding', 'processing', 'approving', 'celebrating']) {
    assert.match(life, new RegExp(`${action}:`));
  }
  assert.match(css, /pv-pocket-recorder/);
  assert.match(css, /pv-crystal-token/);
  assert.match(lifeCss, /pv-pocket-mode-strip/);
  assert.match(lifeCss, /data-pv-action-state/);
  assert.match(canon, /black, graphite, gunmetal, smoke glass, silver\/chrome and clear crystal/i);
  assert.match(canon, /violet\/purple is no longer the primary product color/i);
});

test('PabloVoice exposes one adaptive Studio while connectivity stays an executor detail', async () => {
  const [creator, auth, productCanon, index] = await Promise.all([
    read('packages/app/creator-online-language.mjs'),
    read('packages/app/remote-auth-ui.mjs'),
    read('docs/PRODUCT_CANON.md'),
    read('packages/app/index.html'),
  ]);

  assert.match(creator, /pvStudioMode/);
  assert.match(creator, /['\"]unified['\"]/);
  assert.match(creator, /pvNetworkMode/);
  assert.match(creator, /['\"]adaptive['\"]/);
  assert.match(creator, /adaptive_unified/);
  assert.match(creator, /data-pv-unified-create/);
  assert.match(creator, /data-song-create-button/);
  assert.match(creator, /data-song-create-hq/);
  assert.match(creator, /ensureSession\(\)/);
  assert.match(creator, /fallbackBeforeRemoteDispatchWhenSupported:\s*true/);
  assert.match(creator, /remoteFailureNeverFabricatesSuccess:\s*true/);
  assert.doesNotMatch(creator, /ONLINE · FULL|OFFLINE · LOCAL|online_full|offline_local/);
  assert.match(auth, /demandDrivenUI:\s*true/);
  assert.match(auth, /noSilentOfflineFallback:\s*true/);
  assert.match(productCanon, /one Studio, one project model and one creative flow/i);
  assert.match(productCanon, /Online\/offline are not product modes/i);
  assert.match(productCanon, /only that action fails honestly/i);
  assert.match(index, /creator-online-language\.mjs/);
});

test('Companions are wired to real existing product destinations instead of decorative fake controls', async () => {
  const ui = await read('packages/app/pablovoice-intimate-ui.mjs');
  assert.match(ui, /data-route=\"compose\"/);
  assert.match(ui, /data-section-map-open/);
  assert.match(ui, /data-beat-lab-open/);
  assert.match(ui, /data-action=\"studio-tab\"\]\[data-value=\"voice\"/);
  assert.match(ui, /data-action=\"studio-tab\"\]\[data-value=\"export\"/);
  assert.match(ui, /data-pv-create=\"instrumental\"/);
});

test('Provider names remain implementation metadata, not intimate product UI labels', async () => {
  const ui = await read('packages/app/pablovoice-intimate-ui.mjs');
  assert.doesNotMatch(ui, /ElevenLabs|Eleven Music|Music v2|\bSuno\b/i);
});

test('Section editing observers are idempotent and do not self-trigger by replacing readiness on every sync', async () => {
  const ui = await read('packages/app/music-section-regeneration-ui.mjs');
  assert.match(ui, /let readiness = list\.querySelector\('\[data-music-regen-readiness\]'\)/);
  assert.match(ui, /if \(!readiness\)/);
  assert.match(ui, /node\.textContent !== text/);
  assert.doesNotMatch(ui, /querySelector\('\[data-music-regen-readiness\]'\)\?\.remove\(\)/);
  assert.match(ui, /modal !== document\.querySelector\('\[data-section-map-modal\]'\)/);
});
