import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const dispatcher = read('supabase/functions/compute-kaggle-voice-train-v1/index.ts')
const worker = read('supabase/functions/kaggle-voice-train-worker-v1/index.ts')
const callback = read('supabase/functions/complete-kaggle-voice-train-v1/index.ts')
const promoter = read('supabase/functions/promote-voice-candidate-v1/index.ts')
const migration = read('supabase/migrations/20260830145500_promote_verified_voice_model_candidate.sql')
const workflow = read('.github/workflows/voice-model-candidate-train.yml')

const APPLIO = '085197e738ce9dd4c0bae1e0a74df5de25b89444'
const ECAPA_REVISION = 'b8937e0343bf9fc9741ab12b445b86a93a6e3e25'

test('candidate training is pinned to the canonical Applio recipe and private Kaggle GPU path', () => {
  for (const source of [dispatcher, callback]) assert.match(source, new RegExp(APPLIO))
  assert.match(worker, /T\['applio_commit'\]/)
  assert.match(worker, /Applio commit binding mismatch/)
  assert.match(dispatcher, /machineShape: 'NvidiaTeslaT4'/)
  assert.match(dispatcher, /sample_rate: 48000/)
  assert.match(dispatcher, /f0_method: 'rmvpe'/)
  assert.match(dispatcher, /embedder_model: 'contentvec'/)
  assert.match(dispatcher, /total_epoch: 200/)
  assert.match(dispatcher, /batch_size: 6/)
  assert.match(dispatcher, /vocoder: 'HiFi-GAN'/)
  assert.match(worker, /run_preprocess_script/)
  assert.match(worker, /run_extract_script/)
  assert.match(worker, /run_train_script/)
  assert.match(worker, /run_infer_script/)
})

test('physical training is budgeted, progress is monotonic and only the actual final epoch can complete', () => {
  assert.match(worker, /RUNTIME_EPOCH_BUDGET=20/)
  assert.match(worker, /target_epoch=min\(requested_epoch,RUNTIME_EPOCH_BUDGET\)/)
  assert.match(worker, /requested_checkpoint_every=max\(1,int\(s\['save_every_epoch'\]\)\)/)
  assert.match(worker, /checkpoint_every=min\(requested_checkpoint_every,target_epoch\)/)
  assert.match(worker, /save_every_epoch=checkpoint_every/)
  assert.match(worker, /'checkpoint_every_epoch':checkpoint_every/)
  assert.match(worker, /'epochs_requested':requested_epoch/)
  assert.match(worker, /'epochs_completed':target_epoch/)
  assert.match(worker, /_progress_state=/)
  assert.match(worker, /remember=False/)
  assert.doesNotMatch(worker, /post\('progress','heartbeat',12/)
  assert.match(worker, /exp\.glob\(f'\{model_name\}_\{target_epoch\}e_\*s\.pth'\)/)
  assert.match(workflow, /timeout-minutes: 240/)
})

test('missing native inference export may recover only from an exact final generator checkpoint', () => {
  assert.match(worker, /exp\.glob\('G_\*\.pth'\)/)
  assert.match(worker, /checkpoint_iteration=int\(checkpoint\.get\('iteration',-1\)\)/)
  assert.match(worker, /checkpoint_iteration != target_epoch/)
  assert.match(worker, /generator checkpoint iteration mismatch/)
  assert.match(worker, /exact final generator checkpoint missing for target epoch/)
  assert.match(worker, /extract_model\(ckpt=ckpt/)
  assert.match(worker, /final checkpoint extraction failed/)
  assert.match(worker, /applio_exact_final_generator_checkpoint_v1/)
  assert.match(worker, /'checkpoint_iteration':checkpoint_iteration/)
  assert.match(worker, /'pth_derivation':pth_derivation/)
  assert.doesNotMatch(worker, /checkpoint_iteration\s*<=\s*target_epoch/)
  assert.doesNotMatch(worker, /checkpoint_iteration\s*<\s*target_epoch/)
})

test('training sources and validation guide are artifact-bound and distinct', () => {
  assert.match(dispatcher, /duplicate_training_source_rejected/)
  assert.match(dispatcher, /separate_validation_guide_required/)
  assert.match(dispatcher, /source_asset_not_training_eligible/)
  assert.match(dispatcher, /validation_guide_missing_or_unverified/)
  assert.match(worker, /check\(raw,src\['sha256'\],f'source \{n\}'\)/)
  assert.match(worker, /check\(guide_raw,validation\['guide_sha256'\],'validation guide'\)/)
})

test('new candidate model is never activated by the training callback', () => {
  assert.match(dispatcher, /inactive_until_verified_ecapa_gte_0_8/)
  assert.match(callback, /from\('voice_models'\)\.upsert\(\{[\s\S]*?status: 'ready', is_active: false/)
  assert.match(callback, /activation_forbidden_before_identity_gate: true/)
  assert.match(callback, /identity_threshold: IDENTITY_THRESHOLD/)
  assert.doesNotMatch(callback, /from\('voice_models'\)\.update\(\{[^}]*is_active:\s*true/)
  assert.doesNotMatch(callback, /promote_verified_voice_model_candidate/)
})

test('Kaggle creates validation audio but is not the trusted speaker-identity authority', () => {
  assert.match(worker, /validation-voice\.flac/)
  assert.match(worker, /validation_uploaded/)
  assert.doesNotMatch(worker, /speechbrain/)
  assert.doesNotMatch(worker, /spkrec-ecapa/)
  assert.doesNotMatch(worker, /cosine_similarity/)
  assert.doesNotMatch(worker, /['"]passed['"]\s*:/)
})

test('callback stages a GitHub OIDC ECAPA attestation instead of fabricating PASS', () => {
  assert.match(callback, /speaker_identity_attestation/)
  assert.match(callback, /waiting_trusted_worker/)
  assert.match(callback, /github_repository_oidc/)
  assert.match(callback, /speechbrain\/spkrec-ecapa-voxceleb/)
  assert.match(callback, new RegExp(ECAPA_REVISION))
  assert.match(callback, /IDENTITY_THRESHOLD = 0\.8/)
  assert.doesNotMatch(callback, /passed:\s*true/)
})

test('promotion requires repository OIDC and a service-role-only transactional RPC', () => {
  assert.match(promoter, /refs\/heads\/main/)
  assert.match(promoter, /pablovoice-production/)
  assert.match(promoter, /promote_verified_voice_model_candidate/)
  assert.match(migration, /security definer/)
  assert.match(migration, /revoke all .* from authenticated/i)
  assert.match(migration, /grant execute .* to service_role/i)
  assert.match(migration, /identity_gate_not_passed/)
  assert.match(migration, /attestation_training_binding_mismatch/)
  assert.match(migration, /training_attestation_binding_mismatch/)
})

test('transactional promotion preserves the frozen identity threshold and trusted model revision', () => {
  assert.match(migration, /v_score is null/)
  assert.match(migration, /v_threshold is null/)
  assert.match(migration, /identity_evidence_invalid/)
  assert.match(migration, /v_threshold <> 0\.8/)
  assert.match(migration, /v_score < v_threshold/)
  assert.match(migration, /speechbrain\/spkrec-ecapa-voxceleb/)
  assert.match(migration, /speechbrain-1\.1\.0/)
  assert.match(migration, new RegExp(ECAPA_REVISION))
  assert.match(migration, /github_repository_oidc/)
  assert.match(migration, /inactive_until_verified_ecapa_gte_0_8/)
  assert.match(migration, /set is_active = false/)
  assert.match(migration, /set is_active = true/)
})

test('late worker error callbacks cannot overwrite completed training jobs', () => {
  assert.match(callback, /\.neq\('status', 'completed'\)/)
  assert.match(callback, /currentJob\?\.status === 'completed'/)
  assert.match(callback, /already_completed: true/)
  assert.match(callback, /job_state_changed/)
})
