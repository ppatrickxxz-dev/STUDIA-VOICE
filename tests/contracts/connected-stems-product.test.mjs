import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('connected stems uses the existing authenticated private route and imports into the same local project', async () => {
  const [stems, results] = await Promise.all([
    read('packages/app/stems-canary.mjs'),
    read('packages/app/stems-result-runtime.mjs'),
  ]);

  assert.match(stems, /RemoteAuthAdapter/);
  assert.match(stems, /ensureRemoteProject\(project\)/);
  assert.match(stems, /recording-ticket-v63/);
  assert.match(stems, /compute-kaggle-v54/);
  assert.match(stems, /waitForStandaloneStems/);
  assert.match(stems, /importStandaloneStems/);
  assert.match(stems, /Separar Vocal \+ Instrumental/);
  assert.match(results, /saveAudioAsset/);
  assert.match(results, /saveProject\(project\)/);
  assert.match(results, /Stem · Vocal/);
  assert.match(results, /Stem · Instrumental/);
});

test('Studio rail exposes stems without turning route validation into acoustic promotion', async () => {
  const [stems, bridge, html] = await Promise.all([
    read('packages/app/stems-canary.mjs'),
    read('packages/app/studio-stems-bridge.mjs'),
    read('packages/app/index.html'),
  ]);

  assert.match(html, /studio-stems-bridge\.mjs/);
  assert.match(bridge, /dataPvStudioStems|pvStudioStems/);
  assert.match(bridge, /STEMS/);
  assert.match(bridge, /noAcousticPassClaim:\s*true/);
  assert.match(stems, /routeValidated:\s*true/);
  assert.match(stems, /b09AcousticValidated:\s*false/);
  assert.match(stems, /acousticPromotion:\s*false/);
  assert.match(stems, /requiresUserComparisonBeforePromotion:\s*true/);
  assert.doesNotMatch(stems, />[^<]*candidate[^<]*</i);
});

test('stems follows online-first policy and requests contextual auth instead of silently degrading', async () => {
  const stems = await read('packages/app/stems-canary.mjs');
  assert.match(stems, /navigator\.onLine === false/);
  assert.match(stems, /pablovoice:request-online-auth/);
  assert.match(stems, /pablovoice:remote-authenticated/);
  assert.match(stems, /Stems precisam de conexão/);
  assert.doesNotMatch(stems, /fallback_allowed:\s*true/);
});
