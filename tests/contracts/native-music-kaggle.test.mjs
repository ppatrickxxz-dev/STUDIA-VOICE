import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const REVISION = 'ca1e85fe9430179831e6bc6be790c332190a3866';
const MODEL = 'acestep-v15-turbo';

async function source(path) { return readFile(new URL(`../../${path}`, import.meta.url), 'utf8'); }
async function computeSource() {
  const root = 'supabase/functions/compute-kaggle-v58/';
  return (await Promise.all(['index.ts','core.ts','handler.ts'].map((file) => source(`${root}${file}`)))).join('\n');
}

test('native music dispatcher uses service-role durable capacity claim and private ticketed Kaggle v58 without exposing credentials', async () => {
  const text = await computeSource();
  const lease = await source('supabase/migrations/20260913174500_music_generation_dispatch_lease.sql');
  const queue = await source('supabase/migrations/20260913211000_music_generation_capacity_queue.sql');
  assert.match(text, /job_type:'music_generation'/);
  assert.match(text, /engine:'ace_step_1_5_turbo'/);
  assert.match(text, /provider:'kaggle'/);
  assert.match(text, /machineShape:'NvidiaTeslaT4'/);
  assert.match(text, /isPrivate:true/);
  assert.match(text, /enableInternet:true/);
  assert.match(text, /createSignedUploadUrl/);
  assert.match(text, /kaggle_callback_hash/);
  assert.match(text, /admin_get_compute_connection/);
  assert.match(text, /Deno\.env\.get\('SUPABASE_SERVICE_ROLE_KEY'\)\|\|secs\.default/);
  assert.match(text, /compute_connection_ready:computeReady/);
  assert.match(text, /music_compute_auth_role_failed/);
  assert.match(text, /claim_music_generation_capacity_job/);
  assert.match(text, /release_music_generation_dispatch_lease/);
  assert.match(text, /status:'queued_capacity'/);
  assert.match(text, /durable_capacity_queue:true/);
  assert.match(text, /kaggle_capacity_busy/);
  assert.match(text, /dispatch_serialized:true/);
  assert.match(lease, /private\.music_generation_dispatch_lease/);
  assert.match(lease, /holder_job_id=excluded\.holder_job_id/);
  assert.match(lease, /expires_at <= now\(\)/);
  assert.match(lease, /service_role_required/);
  assert.match(queue, /claim_music_generation_capacity_job/);
  assert.match(queue, /for update/);
  assert.match(queue, /status='queued_capacity'/);
  assert.match(queue, /status='dispatched'/);
  assert.match(text, /kaggle-worker-source-v58/);
  assert.match(text, /complete-kaggle-pipeline-job-v58/);
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
  assert.doesNotMatch(text, /ticket=.*conn\.secret/);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY[^\n]*ticket/);
  assert.match(text, /fallback_allowed:false/);
});

test('native music creation uses AI direction and resumes the same persisted job instead of timing out while GPU is busy', async () => {
  const dispatcher = await computeSource();
  const client = await source('packages/app/native-music-generation-client.mjs');
  assert.match(client, /remoteProductionDirection/);
  assert.match(client, /bypassGeneratorAdapter: true/);
  assert.match(client, /creative_direction_unavailable/);
  assert.match(client, /const variationSeed = freshVariationSeed\(\)/);
  assert.match(client, /directSongCandidates\(directedInputPlan/);
  assert.match(client, /applyDirectedCandidate\(directedInputPlan, direction\.selected\)/);
  assert.match(client, /plan: directedPlan/);
  assert.match(client, /variation_seed: variationSeed/);
  assert.match(client, /pablovoice_director: director/);
  assert.match(client, /pablovoice_ai_direction: aiDirection/);
  assert.match(client, /while \(dispatch\.status === 'queued_capacity'\)/);
  assert.match(client, /resume_job_id: dispatch\.job_id/);
  assert.match(client, /status: 'waiting_for_gpu'/);
  assert.match(client, /Criação salva na fila/);
  assert.match(client, /source: 'pablovoice_native_music_v2_3'/);
  assert.match(client, /capacityQueue: 'durable_render_jobs'/);
  assert.doesNotMatch(client, /CAPACITY_WAIT_MS/);
  assert.doesNotMatch(client, /music_compute_busy_timeout/);
  assert.match(dispatcher, /const requestedVariation=Number\(body\.variation_seed\)/);
  assert.match(dispatcher, /randomGenerationSeed\(\)/);
  assert.match(dispatcher, /queue_schema:'pablovoice_music_capacity_queue_v1'/);
  assert.match(dispatcher, /queued_generation:generation/);
  assert.match(dispatcher, /resume_job_id/);
  assert.match(dispatcher, /accepted:true/);
  assert.match(dispatcher, /return await requeueCapacity\(msg\)/);
  assert.match(dispatcher, /generation_seed:generationSeed/);
  assert.match(dispatcher, /slice\(0,512\)/);
  assert.match(dispatcher, /shift:3\.0/);
  assert.match(dispatcher, /use_constrained_decoding:true/);
  const claimAt = dispatcher.indexOf('claimCapacity(admin,jobId)');
  const signedUploadAt = dispatcher.indexOf("createSignedUploadUrl(outputPath)");
  assert.ok(claimAt >= 0 && signedUploadAt > claimAt, 'trusted upload/callback material must only be created after GPU capacity is claimed');
  assert.doesNotMatch(dispatcher, /seed:Number\.isFinite\(Number\(plan\.seed\)\)/);
});

test('ACE caption keeps configured vocal range, falsetto policy and explicit exclusions inside the 512 character budget', async () => {
  const dispatcher = await computeSource();
  assert.match(dispatcher, /const lowMidi=clamp\(Math\.round\(Number\(singer\.lowMidi\)\|\|48\),24,96\)/);
  assert.match(dispatcher, /const highMidi=clamp\(Math\.round\(Number\(singer\.highMidi\)\|\|67\),lowMidi,108\)/);
  assert.match(dispatcher, /`MIDI \$\{lowMidi\}-\$\{highMidi\}`/);
  assert.match(dispatcher, /singer\.falsetto\?'falsetto ok':'no falsetto'/);
  assert.match(dispatcher, /map\(v=>clean\(v,24\)\)\.filter\(Boolean\)\.slice\(0,5\)/);
  assert.match(dispatcher, /singerDirection\?`Vocal: \$\{singerDirection\}`:''/);
  assert.match(dispatcher, /avoid\?`Avoid: \$\{avoid\}`:''/);
  assert.match(dispatcher, /songDna\?`Direction: \$\{songDna\}`:''/);
  const vocalAt = dispatcher.indexOf("singerDirection?`Vocal:");
  const avoidAt = dispatcher.indexOf("avoid?`Avoid:");
  const directionAt = dispatcher.indexOf("songDna?`Direction:");
  assert.ok(vocalAt >= 0 && avoidAt > vocalAt && directionAt > avoidAt, 'vocal controls and exclusions must precede optional Song DNA');
});

test('ACE worker pins ACE-Step, forces audited fp32 on Kaggle T4 and retries only inside the same worker', async () => {
  const text = await source('supabase/functions/kaggle-worker-source-v58/index.ts');
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
  assert.match(text, /git','-C',str\(repo\),'fetch','--depth','1','origin',ACE_REVISION/);
  assert.match(text, /uv','sync','--frozen','--no-dev','--python','3\.11'/);
  assert.match(text, /apply_pre_ampere_dtype_patch/);
  assert.match(text, /ace_dtype_patch_source_mismatch/);
  assert.match(text, /ACESTEP_DTYPE/);
  assert.match(text, /os\.environ\['ACESTEP_DTYPE'\]='float32'/);
  assert.match(text, /ace_dtype_override_not_applied/);
  assert.match(text, /PV_GENERATION_DTYPE=/);
  assert.match(text, /PV_ACE_DTYPE_PATCH_SHA256=/);
  assert.match(text, /unexpected_t4_generation_dtype/);
  assert.match(text, /ace_dtype_patch_proof_mismatch/);
  assert.match(text, /prefer_source='modelscope'/);
  assert.match(text, /thinking=False/);
  assert.match(text, /use_constrained_decoding=bool\(g\.get\('use_constrained_decoding',True\)\)/);
  assert.match(text, /requested_shift=float\(g\.get\('shift',3\.0\)\)/);
  assert.match(text, /safe_shift=1\.0 if major and major < 8 else requested_shift/);
  assert.match(text, /for attempt in range\(3\)/);
  assert.match(text, /PV_NUMERIC_RETRY/);
  assert.match(text, /torch\.cuda\.empty_cache/);
  assert.match(text, /PV_GENERATION_SEED=/);
  assert.match(text, /PV_GENERATION_SHIFT=/);
  assert.match(text, /caption_too_long/);
  assert.match(text, /task_type='text2music'/);
  assert.match(text, /audio_format='flac'/);
  assert.match(text, /sha256_file/);
  assert.match(text, /ffprobe/);
  assert.match(text, /upload_to_signed_url/);
  assert.match(text, /callback_token/);
  assert.match(text, /native-music-ace-step-v6-t4-fp32/);
  assert.doesNotMatch(text, /KAGGLE_KEY|KAGGLE_USERNAME|service_role/i);
});

test('music progress endpoint never advertises a retry that has no second dispatch executor and keeps the lease alive only for a live worker', async () => {
  const text = await source('supabase/functions/progress-kaggle-pipeline-job-v58/index.ts');
  assert.match(text, /music_numeric_instability/);
  assert.match(text, /job\.job_type!=='music_generation'&&!!c\.transient/);
  assert.match(text, /touch_music_generation_dispatch_lease/);
  assert.match(text, /release_music_generation_dispatch_lease/);
  assert.match(text, /Tente novamente em instantes/);
});

test('native music callback verifies identity, T4 fp32 provenance, storage and hash before asset persistence and releases GPU capacity', async () => {
  const text = await source('supabase/functions/complete-kaggle-pipeline-job-v58/index.ts');
  assert.match(text, /job\.job_type!=='music_generation'/);
  assert.match(text, /sha256Text\(token\)/);
  assert.match(text, /callback_token_expired/);
  assert.match(text, /engine_identity_mismatch/);
  assert.match(text, /generationDtype!=='float32'/);
  assert.match(text, /invalid_generation_dtype/);
  assert.match(text, /invalid_dtype_patch_proof/);
  assert.match(text, /audio-private/);
  assert.match(text, /kind:'full_mix'/);
  assert.match(text, /sha256:audioSha/);
  assert.match(text, /generation_shift:executedShift/);
  assert.match(text, /generation_dtype:generationDtype/);
  assert.match(text, /dtype_patch_sha256:dtypePatchSha/);
  assert.match(text, /pablovoice_native_music_v2_3/);
  assert.match(text, /dispatch_serialized:Boolean\(p\.dispatch_serialized\)/);
  assert.match(text, /release_music_generation_dispatch_lease/);
  assert.match(text, /proof=\{verified:true/);
  assert.match(text, /status:'finalizing'/);
  assert.match(text, /status:'completed'/);
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
});

test('browser runtime can only address owned RLS job/asset rows, bounds waiting and verifies downloaded bytes', async () => {
  const resultRuntime = await source('packages/app/native-music-result-runtime.mjs');
  const client = await source('packages/app/native-music-generation-client.mjs');
  assert.match(resultRuntime, /authorization = `Bearer \$\{token\}`/);
  assert.match(resultRuntime, /job_type !== 'music_generation'/);
  assert.match(resultRuntime, /'retrying'/);
  assert.match(resultRuntime, /maxWaitMs = 20 \* 60 \* 1000/);
  assert.match(resultRuntime, /technical_error/);
  assert.match(resultRuntime, /asset\.kind !== 'full_mix'/);
  assert.match(resultRuntime, /asset\.storage_bucket !== 'audio-private'/);
  assert.match(resultRuntime, /music_sha256_mismatch/);
  assert.match(resultRuntime, /music_size_mismatch/);
  assert.match(client, /compute-kaggle-v58/);
  assert.match(client, /ensureRemoteProject/);
  assert.match(client, /ensureSession/);
  assert.match(client, /fallback_allowed: false/);
  assert.match(client, /directionEngine: 'pablovoice_ai_direction_plus_song_director_v2'/);
  assert.doesNotMatch(client, /ELEVENLABS_API_KEY|KAGGLE_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});
