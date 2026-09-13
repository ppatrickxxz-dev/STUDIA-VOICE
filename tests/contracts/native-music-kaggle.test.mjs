import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const REVISION = 'ca1e85fe9430179831e6bc6be790c332190a3866';
const MODEL = 'acestep-v15-turbo';

async function source(path) { return readFile(new URL(`../../${path}`, import.meta.url), 'utf8'); }

test('native music dispatcher uses service-role RPC access, serialized capacity and private ticketed Kaggle v58 without exposing credentials', async () => {
  const text = await source('supabase/functions/compute-kaggle-v58/index.ts');
  const lease = await source('supabase/migrations/20260913174500_music_generation_dispatch_lease.sql');
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
  assert.match(text, /acquire_music_generation_dispatch_lease/);
  assert.match(text, /release_music_generation_dispatch_lease/);
  assert.match(text, /music_compute_busy/);
  assert.match(text, /kaggle_capacity_busy/);
  assert.match(text, /dispatch_serialized:true/);
  assert.match(lease, /private\.music_generation_dispatch_lease/);
  assert.match(lease, /holder_job_id=excluded\.holder_job_id/);
  assert.match(lease, /expires_at <= now\(\)/);
  assert.match(lease, /service_role_required/);
  assert.match(text, /kaggle-worker-source-v58/);
  assert.match(text, /complete-kaggle-pipeline-job-v58/);
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
  assert.doesNotMatch(text, /ticket=.*conn\.secret/);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY[^\n]*ticket/);
  assert.match(text, /fallback_allowed:false/);
});

test('native music creation obtains remote AI production direction, uses Song DNA, fresh variation and waits for shared GPU capacity', async () => {
  const dispatcher = await source('supabase/functions/compute-kaggle-v58/index.ts');
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
  assert.match(client, /CAPACITY_WAIT_MS = 8 \* 60 \* 1000/);
  assert.match(client, /dispatch\?\.error === 'music_compute_busy'/);
  assert.match(client, /status: 'waiting_for_gpu'/);
  assert.match(client, /A GPU está terminando outra criação/);
  assert.match(client, /source: 'pablovoice_native_music_v2_2'/);
  assert.match(dispatcher, /const requestedVariation=Number\(body\.variation_seed\)/);
  assert.match(dispatcher, /randomGenerationSeed\(\)/);
  assert.match(dispatcher, /generation_seed:generationSeed/);
  assert.match(dispatcher, /slice\(0,512\)/);
  assert.match(dispatcher, /shift:3\.0/);
  assert.match(dispatcher, /use_constrained_decoding:true/);
  assert.doesNotMatch(dispatcher, /seed:Number\.isFinite\(Number\(plan\.seed\)\)/);
});

test('native music worker pins ACE-Step, protects Kaggle T4 from fp16 latent overflow and retries only inside the same worker', async () => {
  const text = await source('supabase/functions/kaggle-worker-source-v58/index.ts');
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
  assert.match(text, /git','-C',str\(repo\),'fetch','--depth','1','origin',ACE_REVISION/);
  assert.match(text, /uv','sync','--frozen','--no-dev','--python','3\.11'/);
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

test('native music callback verifies identity, callback, storage and hash before asset persistence and releases GPU capacity', async () => {
  const text = await source('supabase/functions/complete-kaggle-pipeline-job-v58/index.ts');
  assert.match(text, /job\.job_type!=='music_generation'/);
  assert.match(text, /sha256Text\(token\)/);
  assert.match(text, /callback_token_expired/);
  assert.match(text, /engine_identity_mismatch/);
  assert.match(text, /audio-private/);
  assert.match(text, /kind:'full_mix'/);
  assert.match(text, /sha256:audioSha/);
  assert.match(text, /generation_shift:executedShift/);
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
