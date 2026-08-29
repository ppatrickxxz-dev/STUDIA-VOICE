import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../../supabase/functions/test-voice-v71-identity-once/index.ts', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../supabase/migrations/20260829104000_harden_voice_identity_reference_triggers.sql', import.meta.url), 'utf8');

test('speaker identity runtime is bound to verified artifacts and the frozen provisional policy', () => {
  assert.match(runtime, /speaker_identity_attestation/);
  assert.match(runtime, /candidate_sha256/);
  assert.match(runtime, /reference_sha256/);
  assert.match(runtime, /reference_id/);
  assert.match(runtime, /voice_model_id/);
  assert.match(runtime, /const THRESHOLD=\.8/);
  assert.match(runtime, /speechbrain\/spkrec-ecapa-voxceleb/);
  assert.match(runtime, /speechbrain-1\.0\.3/);
  assert.match(runtime, /candidate sha256 mismatch/);
  assert.match(runtime, /reference sha256 mismatch/);
  assert.match(runtime, /artifact_hash_mismatch/);
  assert.match(runtime, /identity_binding_mismatch/);
  assert.match(runtime, /score_contract_mismatch/);
});

test('worker uses ECAPA-TDNN speaker embeddings without exposing the raw biometric vector', () => {
  assert.match(runtime, /speechbrain\.inference\.speaker import EncoderClassifier/);
  assert.match(runtime, /encode_batch\(cs\)/);
  assert.match(runtime, /encode_batch\(rs\)/);
  assert.match(runtime, /cosine_similarity/);
  assert.match(runtime, /raw_embedding_exposed:false/);
  assert.doesNotMatch(runtime, /contentvec/);
  assert.doesNotMatch(runtime, /speakerEmbedding\s*:/);
});

test('callback cannot choose its own threshold, engine, pass state, or artifact identity', () => {
  assert.match(runtime, /passed!==\(score>=THRESHOLD\)/);
  assert.match(runtime, /String\(b\.engine\|\|''\)!==MODEL/);
  assert.match(runtime, /String\(b\.engine_version\|\|''\)!==ENGINE_VERSION/);
  assert.match(runtime, /await sha\(cb\)!==String\(p\.callback_hash\|\|''\)/);
});

test('identity reference trigger is not directly executable as a public RPC', () => {
  assert.match(migration, /touch_voice_identity_reference\(\) set search_path = public, pg_temp/);
  assert.match(migration, /revoke execute on function public\.validate_voice_identity_reference\(\) from public/);
  assert.match(migration, /from anon/);
  assert.match(migration, /from authenticated/);
});
