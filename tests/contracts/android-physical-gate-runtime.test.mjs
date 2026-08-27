import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const preboot = await readFile(new URL('../../packages/app/preboot.mjs', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../../packages/app/physical-gate-runtime.mjs', import.meta.url), 'utf8');
const storage = await readFile(new URL('../../packages/app/storage.mjs', import.meta.url), 'utf8');

test('physical gate recovery installs before app boot', () => {
  assert.match(preboot, /installAudioPlaybackRecovery\(\);[\s\S]*await import\('\.\/app\.js'\)/);
  assert.match(preboot, /installPhysicalGateRuntime\(\)/);
});

test('playback retries after IndexedDB buffer recovery', () => {
  assert.match(runtime, /Nenhuma faixa audível foi carregada/);
  assert.match(runtime, /recoverAudioBuffers\(project, this\)/);
  assert.match(runtime, /getAudioAsset\(track\.assetId\)/);
  assert.match(runtime, /originalPlay\.call\(this, project, options\)/);
});

test('natural create-music request routes to Composer instead of dead-ending', () => {
  assert.match(runtime, /data-pablo-form/);
  assert.match(runtime, /PENDING_COMPOSER_KEY/);
  assert.match(runtime, /data-route="compose"/);
  assert.match(runtime, /pv-ai-composer/);
});

test('project ordering respects the physically active project identity', () => {
  assert.match(storage, /ACTIVE_PROJECT_SESSION_KEY/);
  assert.match(storage, /activeProjectSessionId\(\)/);
  assert.match(storage, /sortProjectsByContext\(projects, activeId\)/);
});
