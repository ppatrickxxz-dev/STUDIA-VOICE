import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const canary = await readFile(new URL('../../packages/app/stems-canary.mjs', import.meta.url), 'utf8');
const html = await readFile(new URL('../../packages/app/index.html', import.meta.url), 'utf8');

test('studio canary uses authenticated remote project and verified source import', () => {
  assert.match(canary, /RemoteAuthAdapter/);
  assert.match(canary, /ensureSession\(\)/);
  assert.match(canary, /ensureRemoteProject\(project\)/);
  assert.match(canary, /source_type:'source_import'/);
  assert.match(canary, /recording-ticket-v63/);
  assert.match(canary, /recording-finalize-v63/);
  assert.match(canary, /sha256/);
});

test('studio canary dispatches only through the deployed free-tier alias', () => {
  assert.match(canary, /compute-kaggle-v54/);
  assert.match(canary, /source_asset_id/);
  assert.doesNotMatch(canary, /service_role/i);
  assert.doesNotMatch(canary, /SUPABASE_SERVICE_ROLE_KEY/);
});

test('candidate remains explicitly unpromoted and CSP stays strict', () => {
  assert.match(canary, /routeValidated:false/);
  assert.match(html, /stems-canary\.mjs/);
  assert.match(html, /connect-src 'self' https:\/\/yokmhqoncdwvxmzzybqa\.supabase\.co/);
  assert.doesNotMatch(html, /unsafe-inline/);
});
