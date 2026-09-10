import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const REVISION = 'ca1e85fe9430179831e6bc6be790c332190a3866';
const MODEL = 'acestep-v15-turbo';

async function source(path) { return readFile(new URL(`../../${path}`, import.meta.url), 'utf8'); }

test('native music dispatcher reuses private ticketed Kaggle v58 slot without exposing privileged credentials', async () => {
  const text = await source('supabase/functions/compute-kaggle-v58/index.ts');
  assert.match(text, /job_type:'music_generation'/);
  assert.match(text, /engine:'ace_step_1_5_turbo'/);
  assert.match(text, /provider:'kaggle'/);
  assert.match(text, /machineShape:'NvidiaTeslaT4'/);
  assert.match(text, /isPrivate:true/);
  assert.match(text, /enableInternet:true/);
  assert.match(text, /createSignedUploadUrl/);
  assert.match(text, /kaggle_callback_hash/);
  assert.match(text, /admin_get_compute_connection/);
  assert.match(text, /kaggle-worker-source-v58/);
  assert.match(text, /complete-kaggle-pipeline-job-v58/);
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
  assert.doesNotMatch(text, /ticket=.*conn\.secret/);
  assert.doesNotMatch(text, /SUPABASE_SERVICE_ROLE_KEY[^\n]*ticket/);
  assert.match(text, /fallback_allowed:false/);
});

test('native music creation keeps the creative brief and requests a fresh variation per take', async () => {
  const dispatcher = await source('supabase/functions/compute-kaggle-v58/index.ts');
  const client = await source('packages/app/native-music-generation-client.mjs');
  assert.match(client, /variation_seed: freshVariationSeed\(\)/);
  assert.match(dispatcher, /const requestedVariation=Number\(body\.variation_seed\)/);
  assert.match(dispatcher, /randomGenerationSeed\(\)/);
  assert.match(dispatcher, /generation_seed:generationSeed/);
  assert.match(dispatcher, /slice\(0,1400\)/);
  assert.doesNotMatch(dispatcher, /seed:Number\.isFinite\(Number\(plan\.seed\)\)/);
});

test('native music worker pins ACE-Step source identity and returns only signed output plus callback proof', async () => {
  const text = await source('supabase/functions/kaggle-worker-source-v58/index.ts');
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
  assert.match(text, /git','-C',str\(repo\),'fetch','--depth','1','origin',ACE_REVISION/);
  assert.match(text, /uv','sync','--frozen','--no-dev','--python','3\.11'/);
  assert.match(text, /prefer_source='modelscope'/);
  assert.match(text, /thinking=False/);
  assert.match(text, /task_type='text2music'/);
  assert.match(text, /audio_format='flac'/);
  assert.match(text, /sha256_file/);
  assert.match(text, /ffprobe/);
  assert.match(text, /upload_to_signed_url/);
  assert.match(text, /callback_token/);
  assert.doesNotMatch(text, /KAGGLE_KEY|KAGGLE_USERNAME|service_role/i);
});

test('native music callback verifies identity, callback, storage and hash before asset persistence', async () => {
  const text = await source('supabase/functions/complete-kaggle-pipeline-job-v58/index.ts');
  assert.match(text, /job\.job_type!=='music_generation'/);
  assert.match(text, /sha256Text\(token\)/);
  assert.match(text, /callback_token_expired/);
  assert.match(text, /engine_identity_mismatch/);
  assert.match(text, /audio-private/);
  assert.match(text, /kind:'full_mix'/);
  assert.match(text, /sha256:audioSha/);
  assert.match(text, /proof=\{verified:true/);
  assert.match(text, /status:'finalizing'/);
  assert.match(text, /status:'completed'/);
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
});

test('browser runtime can only address owned RLS job/asset rows and verifies downloaded bytes', async () => {
  const resultRuntime = await source('packages/app/native-music-result-runtime.mjs');
  const client = await source('packages/app/native-music-generation-client.mjs');
  assert.match(resultRuntime, /authorization = `Bearer \$\{token\}`/);
  assert.match(resultRuntime, /job_type !== 'music_generation'/);
  assert.match(resultRuntime, /asset\.kind !== 'full_mix'/);
  assert.match(resultRuntime, /asset\.storage_bucket !== 'audio-private'/);
  assert.match(resultRuntime, /music_sha256_mismatch/);
  assert.match(resultRuntime, /music_size_mismatch/);
  assert.match(client, /compute-kaggle-v58/);
  assert.match(client, /ensureRemoteProject/);
  assert.match(client, /ensureSession/);
  assert.match(client, /fallback_allowed: false/);
  assert.doesNotMatch(client, /ELEVENLABS_API_KEY|KAGGLE_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});
