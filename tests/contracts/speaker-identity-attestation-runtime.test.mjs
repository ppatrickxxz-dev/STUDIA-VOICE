import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../../supabase/functions/test-voice-v71-identity-once/index.ts', import.meta.url), 'utf8');
const worker = await readFile(new URL('../../.github/workflows/speaker-identity-trusted-worker.yml', import.meta.url), 'utf8');
const migration = await readFile(new URL('../../supabase/migrations/20260829104000_harden_voice_identity_reference_triggers.sql', import.meta.url), 'utf8');

const compact = (value) => value.replace(/\s+/g, '');

test('speaker identity runtime is bound to distinct verified artifacts and the frozen provisional policy', () => {
  assert.match(runtime, /speaker_identity_attestation/);
  assert.match(runtime, /candidate_asset_id/);
  assert.match(runtime, /candidate_sha256/);
  assert.match(runtime, /reference_asset_id/);
  assert.match(runtime, /reference_sha256/);
  assert.match(runtime, /reference_id/);
  assert.match(runtime, /voice_model_id/);
  assert.match(runtime, /const THRESHOLD\s*=\s*0\.8/);
  assert.match(runtime, /speechbrain\/spkrec-ecapa-voxceleb/);
  assert.match(runtime, /speechbrain-1\.1\.0/);
  assert.match(runtime, /MODEL_REVISION\s*=\s*'b8937e0343bf9fc9741ab12b445b86a93a6e3e25'/);
  assert.match(runtime, /identity_self_reference_rejected/);
  assert.match(runtime, /artifact_hash_mismatch/);
  assert.match(runtime, /identity_binding_mismatch/);
  assert.match(runtime, /engine_contract_mismatch/);
  assert.match(runtime, /score_contract_mismatch/);
  assert.match(runtime, /trusted_authority:\s*'github_repository_oidc'/);
});

test('trusted GitHub worker performs pinned ECAPA scoring without exposing raw biometric vectors', () => {
  assert.match(worker, /id-token:\s*write/);
  assert.match(worker, /environment:\s*pablovoice-production/);
  assert.match(worker, /speechbrain==1\.1\.0/);
  assert.match(worker, /MODEL_REVISION:\s*b8937e0343bf9fc9741ab12b445b86a93a6e3e25/);
  assert.match(worker, /speechbrain\.inference\.speaker import EncoderClassifier/);
  assert.match(worker, /encode_batch\(c\)/);
  assert.match(worker, /encode_batch\(r\)/);
  assert.match(worker, /cosine_similarity/);
  assert.match(worker, /sha256sum \/tmp\/pv-candidate\.bin/);
  assert.match(worker, /sha256sum \/tmp\/pv-reference\.bin/);
  assert.match(worker, /-ar 16000 -ac 1/);
  assert.match(worker, /"action":"worker_claim"/);
  assert.match(worker, /--arg action complete/);
  assert.doesNotMatch(worker, /service_role/i);
  assert.doesNotMatch(worker, /speakerEmbedding\s*:/);
  assert.doesNotMatch(runtime, /speakerEmbedding\s*:/);
  assert.match(runtime, /raw_embedding_exposed:\s*false/);
});

test('trusted completion cannot choose its own threshold, engine, pass state, artifact identity, or run', () => {
  const source = compact(runtime);
  assert.match(source, /passed!==\(score>=THRESHOLD\)/);
  assert.match(source, /String\(body\.engine\|\|''\)!==MODEL/);
  assert.match(source, /String\(body\.engine_version\|\|''\)!==ENGINE_VERSION/);
  assert.match(source, /String\(body\.model_revision\|\|''\)!==MODEL_REVISION/);
  assert.match(source, /String\(p\.trusted_run_id\|\|''\)!==runId/);
  assert.match(source, /csha!==String\(p\.candidate_sha256\|\|''\)\.toLowerCase\(\)/);
  assert.match(source, /rsha!==String\(p\.reference_sha256\|\|''\)\.toLowerCase\(\)/);
  assert.match(source, /csha===rsha/);
  assert.match(source, /String\(p\.candidate_asset_id\)===String\(p\.reference_asset_id\)/);
  assert.match(runtime, /if \(ue\) return out\(\{ ok: false, error: 'job_finalization_failed' \}, 500\)/);
});

test('GitHub OIDC verification pins repository, main ref, production environment and signed token', () => {
  assert.match(runtime, /https:\/\/token\.actions\.githubusercontent\.com/);
  assert.match(runtime, /pablovoice-signing/);
  assert.match(runtime, /ppatrickxxz-dev\/STUDIA-VOICE/);
  assert.match(runtime, /refs\/heads\/main/);
  assert.match(runtime, /pablovoice-production/);
  assert.match(runtime, /RSASSA-PKCS1-v1_5/);
  assert.match(runtime, /crypto\.subtle\.verify/);
  assert.match(runtime, /oidc_signature/);
  assert.match(runtime, /oidc_repository/);
  assert.match(runtime, /oidc_ref/);
  assert.match(runtime, /oidc_environment/);
  assert.doesNotMatch(runtime, /admin_get_compute_connection/);
  assert.doesNotMatch(runtime, /callback_token/);
  assert.doesNotMatch(runtime, /kaggle/i);
});

test('manual identity canary is main-only and uses a real user session before trusted processing', () => {
  assert.match(worker, /if:\s*github\.ref == 'refs\/heads\/main'/);
  assert.match(worker, /IDENTITY_CANARY_CANDIDATE_ID:\s*6f4ade75-6106-4a28-ae52-d0d9e89af00a/);
  assert.match(worker, /functions\/v1\/device-auth/);
  assert.match(worker, /"action":"b09_session"/);
  assert.match(worker, /\\"action\\":\\"dispatch\\"/);
  assert.match(worker, /candidate_asset_id/);
  assert.match(worker, /waiting_trusted_worker/);
  assert.match(worker, /github_repository_oidc/);
});

test('identity reference trigger is not directly executable as a public RPC', () => {
  assert.match(migration, /touch_voice_identity_reference\(\) set search_path = public, pg_temp/);
  assert.match(migration, /revoke execute on function public\.validate_voice_identity_reference\(\) from public/);
  assert.match(migration, /from anon/);
  assert.match(migration, /from authenticated/);
});
