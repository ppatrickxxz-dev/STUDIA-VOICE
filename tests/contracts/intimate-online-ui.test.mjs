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
  for (const state of ['idle', 'listening', 'thinking', 'recording', 'happy', 'dancing']) assert.match(ui, new RegExp(`['\"]${state}['\"]`));
  for (const mode of ['vibe', 'focus', 'inspiration', 'moment']) assert.match(life, new RegExp(`id: ['\"]${mode}['\"]`));
  for (const action of ['listening', 'thinking', 'creating', 'analyzing', 'guiding', 'processing', 'approving', 'celebrating']) assert.match(life, new RegExp(`${action}:`));
  assert.match(css, /pv-pocket-recorder/);
  assert.match(css, /pv-crystal-token/);
  assert.match(lifeCss, /pv-pocket-mode-strip/);
  assert.match(lifeCss, /data-pv-action-state/);
  assert.match(canon, /black, graphite, gunmetal, smoke glass, silver\/chrome and clear crystal/i);
  assert.match(canon, /violet\/purple is no longer the primary product color/i);
});

test('PabloVoice exposes one connected Studio with no login prompt and no offline/local product mode', async () => {
  const [creator, auth, access, productCanon, index, unifiedCss] = await Promise.all([
    read('packages/app/creator-unified-runtime.mjs'),
    read('packages/app/remote-auth-ui.mjs'),
    read('packages/app/unified-online-policy.mjs'),
    read('docs/PRODUCT_CANON.md'),
    read('packages/app/index.html'),
    read('packages/app/pablovoice-unified-ui.css'),
  ]);

  assert.match(creator, /pvStudioMode/);
  assert.match(creator, /['\"]unified['\"]/);
  assert.match(creator, /pvNetworkMode/);
  assert.match(creator, /['\"]online['\"]/);
  assert.match(creator, /online_only/);
  assert.match(creator, /high_quality_only/);
  assert.match(creator, /data-pv-unified-create/);
  assert.match(creator, /querySelectorAll\('\[data-pv-local-draft\]'\).*remove/);
  assert.doesNotMatch(creator, /data-pv-local-draft>Rascunho local/);
  assert.match(creator, /data-song-create-hq/);
  assert.match(creator, /ensureSession\(\)/);
  assert.match(creator, /localDraftAvailable:\s*false/);
  assert.match(creator, /userLoginRequired:\s*false/);
  assert.match(creator, /passwordPrompt:\s*false/);
  assert.match(creator, /transparentDeviceAccess:\s*true/);
  assert.match(creator, /offlineMode:\s*false/);
  assert.match(creator, /remoteFailureNeverFabricatesSuccess:\s*true/);

  assert.match(auth, /transparentDeviceAccess:\s*true/);
  assert.match(auth, /userLoginUI:\s*false/);
  assert.match(auth, /creatorSurfaceVisible:\s*false/);
  assert.doesNotMatch(auth, /Acesso do proprietário|Liberar meu estúdio|autocomplete="email"/);

  assert.match(access, /productMode:\s*'unified'/);
  assert.match(access, /creationMode:\s*'online_high_quality_only'/);
  assert.match(access, /userLoginRequired:\s*false/);
  assert.match(access, /passwordPrompt:\s*false/);
  assert.match(access, /offlineMode:\s*false/);
  assert.match(access, /localDraftAvailable:\s*false/);
  assert.match(access, /data-pv-local-draft/);
  assert.match(access, /data-song-create-button/);
  assert.match(access, /pvOfflineMode', 'false'/);
  assert.match(access, /pvAccessMode', 'transparent-device'/);
  assert.match(access, /pvNetworkPolicy', 'online_only'/);
  assert.match(access, /pvExecutionPolicy', 'high_quality_only'/);
  assert.match(access, /function setDataset/);
  assert.match(access, /dataset\?\.\[key\] !== value/);
  assert.match(access, /if \(node && !node\.hidden\) node\.hidden = true/);
  assert.match(access, /attributeFilter:\s*\['data-pv-network-policy'\]/);
  assert.doesNotMatch(access, /html\.dataset\.pvNetworkMode = 'online'/);

  assert.match(productCanon, /one Studio, one project model and one creative flow/i);
  assert.match(productCanon, /Online\/offline are not product modes/i);
  assert.match(index, /data-pv-studio-mode="unified"/);
  assert.match(index, /data-pv-access-mode="transparent-device"/);
  assert.match(index, /data-pv-offline-mode="false"/);
  assert.match(index, /creator-unified-runtime\.mjs/);
  assert.match(index, /unified-online-policy\.mjs/);
  assert.doesNotMatch(index, /src=\"\.\/creator-online-language\.mjs\"/);
  assert.match(unifiedCss, /STUDIO · PRONTO/);
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
