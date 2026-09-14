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

test('PabloVoice is one Studio whose local project survives offline while professional generation queues for connection', async () => {
  const [creator, auth, access, productCanon, index, songCreator] = await Promise.all([
    read('packages/app/creator-unified-runtime.mjs'),
    read('packages/app/remote-auth-ui.mjs'),
    read('packages/app/unified-online-policy.mjs'),
    read('docs/PRODUCT_CANON.md'),
    read('packages/app/index.html'),
    read('packages/app/song-creation-studio.mjs'),
  ]);

  // Connectivity is a state of the same product, not a second local/offline product.
  assert.match(creator, /pvStudioMode/);
  assert.match(creator, /['\"]unified['\"]/);
  assert.match(creator, /pvNetworkMode/);
  assert.match(creator, /navigator\.onLine !== false/);
  assert.match(creator, /online \? 'online' : 'offline'/);
  assert.match(creator, /connectivityIsImplementationDetail:\s*true/);
  assert.match(creator, /injectsAlternativeCreator:\s*false/);
  assert.match(creator, /hidesProfessionalCreator:\s*false/);
  assert.match(creator, /localToyFallback:\s*false/);
  assert.match(creator, /pendingNetworkActionsArePreserved:\s*true/);
  assert.match(creator, /userLoginRequired:\s*false/);
  assert.match(creator, /passwordPrompt:\s*false/);
  assert.match(creator, /transparentDeviceAccess:\s*true/);

  // No owner login/code wall is allowed back into the product.
  assert.match(auth, /transparentDeviceAccess:\s*true/);
  assert.match(auth, /userLoginUI:\s*false/);
  assert.match(auth, /creatorSurfaceVisible:\s*false/);
  assert.doesNotMatch(auth, /Acesso do proprietário|Liberar meu estúdio|autocomplete="email"/);

  // Legacy online-only policy may not hide the professional Creator anymore.
  assert.match(access, /productMode:\s*'unified'/);
  assert.match(access, /creationMode:\s*'professional_remote_with_offline_queue'/);
  assert.match(access, /localProjectAvailableOffline:\s*true/);
  assert.match(access, /localToyFallback:\s*false/);
  assert.match(access, /pendingNetworkActionsArePreserved:\s*true/);
  assert.match(access, /pvNetworkPolicy', 'offline_queue'/);
  assert.match(access, /pvExecutionPolicy', 'professional_only'/);
  assert.match(access, /pvConnectivity', online \? 'online' : 'offline'/);
  assert.doesNotMatch(access, /querySelectorAll\('\[data-song-create-hq\]'\).*hidden/);
  assert.doesNotMatch(access, /online_only|high_quality_only/);

  // Creation itself queues the exact request offline instead of fabricating audio.
  assert.match(songCreator, /if \(navigator\.onLine === false\)/);
  assert.match(songCreator, /await queueOfflineGeneration\(request\)/);
  assert.match(songCreator, /pedido ficou salvo neste aparelho/i);
  assert.match(songCreator, /localToyFallback:\s*false/);
  assert.match(songCreator, /offlineGenerationRequestQueue:\s*true/);
  assert.match(songCreator, /data-song-create-hq>✦ Criar 2 versões/);

  assert.match(productCanon, /one Studio, one project model and one creative flow/i);
  assert.match(productCanon, /Online\/offline are not product modes/i);
  assert.match(index, /data-pv-studio-mode="unified"/);
  assert.match(index, /data-pv-access-mode="transparent-device"/);
  assert.match(index, /creator-unified-runtime\.mjs/);
  assert.match(index, /unified-online-policy\.mjs/);
  assert.doesNotMatch(index, /src=\"\.\/creator-online-language\.mjs\"/);
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
