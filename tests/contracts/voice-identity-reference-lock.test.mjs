import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../supabase/migrations/20260827_voice_identity_reference_lock.sql', import.meta.url), 'utf8');
const rpc = await readFile(new URL('../../supabase/migrations/20260827_voice_identity_reference_rpc.sql', import.meta.url), 'utf8');
const client = await readFile(new URL('../../packages/providers/src/voice-identity-reference-client.mjs', import.meta.url), 'utf8');
const ui = await readFile(new URL('../../packages/app/voice-identity-reference-ui.mjs', import.meta.url), 'utf8');

test('identity reference accepts only original source/take assets', () => {
  assert.match(migration, /asset_kind not in \('take', 'source'\)/);
  assert.match(rpc, /asset_kind not in \('take', 'source'\)/);
  assert.match(client, /kind=in\.\(take,source\)/);
  assert.doesNotMatch(client, /pablo_voice_variant|guide_vocal/);
});

test('identity reference is owner-scoped and RLS protected', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\)\) = user_id/);
  assert.match(migration, /model_owner <> new\.user_id/);
  assert.match(migration, /asset_owner <> new\.user_id/);
  assert.match(rpc, /auth\.uid\(\)/);
});

test('one active reference is enforced per voice model', () => {
  assert.match(migration, /unique index[\s\S]+user_id, voice_model_id[\s\S]+where is_active/i);
  assert.match(rpc, /set is_active = false/);
  assert.match(rpc, /is_active[\s\S]+true/);
});

test('reference hash comes from verified asset and cannot be user forged', () => {
  assert.match(migration, /new\.source_sha256 := asset_sha/);
  assert.match(migration, /identity_reference_asset_unverified/);
  assert.match(rpc, /select lower\(sha256\), kind into asset_sha/);
});

test('runtime never returns signed audio URLs or speaker embeddings and never auto-selects', () => {
  assert.doesNotMatch(client, /createSignedUrl|storage_path|signedUrl/);
  assert.doesNotMatch(client, /speaker_embedding|embedding_vector|raw_embedding/i);
  assert.match(ui, /Nada é escolhido automaticamente/);
});
