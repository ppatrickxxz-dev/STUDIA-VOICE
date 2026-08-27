import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../../supabase/migrations/20260827_voice_identity_reference_lock.sql', import.meta.url), 'utf8');
const fn = await readFile(new URL('../../supabase/functions/voice-identity-reference-v1/index.ts', import.meta.url), 'utf8');

test('identity reference accepts only original source/take assets', () => {
  assert.match(migration, /asset_kind not in \('take', 'source'\)/);
  assert.match(fn, /\.in\('kind', \['take', 'source'\]\)/);
  assert.doesNotMatch(fn, /pablo_voice_variant/);
  assert.doesNotMatch(fn, /guide_vocal/);
});

test('identity reference is owner-scoped and RLS protected', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /auth\.uid\(\)\) = user_id/);
  assert.match(migration, /model_owner <> new\.user_id/);
  assert.match(migration, /asset_owner <> new\.user_id/);
  assert.match(fn, /\.eq\('user_id', user\.id\)/);
});

test('one active reference is enforced per voice model', () => {
  assert.match(migration, /unique index[\s\S]+user_id, voice_model_id[\s\S]+where is_active/i);
  assert.match(fn, /update\(\{ is_active: false \}\)/);
  assert.match(fn, /is_active: true/);
});

test('reference hash comes from verified asset and cannot be user forged', () => {
  assert.match(migration, /new\.source_sha256 := asset_sha/);
  assert.match(migration, /identity_reference_asset_unverified/);
  assert.match(fn, /String\(asset\.sha256\)\.toLowerCase\(\)/);
});

test('API never returns signed audio URLs or speaker embeddings', () => {
  assert.doesNotMatch(fn, /createSignedUrl/);
  assert.doesNotMatch(fn, /speaker_embedding|embedding_vector|raw_embedding/i);
  assert.match(fn, /automatic_selection: false/);
});
