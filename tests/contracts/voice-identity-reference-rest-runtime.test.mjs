import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const client = await readFile(new URL('../../packages/providers/src/voice-identity-reference-client.mjs', import.meta.url), 'utf8');
const ui = await readFile(new URL('../../packages/app/voice-identity-reference-ui.mjs', import.meta.url), 'utf8');
const preboot = await readFile(new URL('../../packages/app/preboot.mjs', import.meta.url), 'utf8');
const rpc = await readFile(new URL('../../supabase/migrations/20260827_voice_identity_reference_rpc.sql', import.meta.url), 'utf8');

test('identity reference runtime uses PostgREST and atomic RPC instead of another Edge Function', () => {
  assert.match(client, /\/rest\/v1\/voice_identity_references/);
  assert.match(client, /\/rest\/v1\/rpc\/set_voice_identity_reference/);
  assert.match(client, /\/rest\/v1\/rpc\/clear_voice_identity_reference/);
  assert.doesNotMatch(client, /functions\/v1/);
});

test('selector never auto-selects a human identity reference', () => {
  assert.match(ui, /Nada é escolhido automaticamente/);
  assert.match(ui, /Escolha uma gravação original/);
  assert.doesNotMatch(ui, /select\.selectedIndex\s*=\s*[1-9]/);
});

test('runtime exposes only source/take candidates and no signed audio URL', () => {
  assert.match(client, /kind=in\.\(take,source\)/);
  assert.match(client, /\['take', 'source'\]/);
  assert.doesNotMatch(client, /createSignedUrl|storage_path|signedUrl/);
});

test('atomic RPC is authenticated and source restricted', () => {
  assert.match(rpc, /auth\.uid\(\)/);
  assert.match(rpc, /asset_kind not in \('take', 'source'\)/);
  assert.match(rpc, /update public\.voice_identity_references[\s\S]+is_active = false/);
  assert.match(rpc, /insert into public\.voice_identity_references/);
  assert.match(rpc, /security invoker/);
});

test('canonical boot installs the reference selector', () => {
  assert.match(preboot, /voice-identity-reference-ui\.mjs/);
  assert.match(preboot, /installVoiceIdentityReferenceUI\(\)/);
});
