import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const REVISION = 'ca1e85fe9430179831e6bc6be790c332190a3866';
const MODEL = 'acestep-v15-turbo';

async function source(path) { return readFile(new URL(`../../${path}`, import.meta.url), 'utf8'); }

test('native music dispatcher reuses private ticketed Kaggle v58 slot without exposing privileged credentials', async () => {
  const text = await source('supabase/functions/compute-kaggle-v58/index.ts');
  assert.match(text, /jobType='music_generation'/);
  assert.match(text, /jobType='music_repaint'/);
  assert.match(text, /engine:'ace_step_1_5_turbo'/);
  assert.match(text, /provider:'kaggle'/);
  assert.match(text, /machineShape:'NvidiaTeslaT4'/);
  assert.match(text, /isPrivate:true/);
  assert.match(text, /enableInternet:true/);
  assert.match(text, /createSignedUploadUrl/);
  assert.match(text, /createSignedUrl\(asset\.storage_path,3600\)/);
  assert.match(text, /source_asset_not_repaintable/);
  assert.match(text, /invalid_repaint_range/);
  assert.match(text, /chunk_mask_mode:'explicit'/);
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

test('native music worker pins ACE-Step source identity and executes explicit repaint against SHA-verified source audio', async () => {
  const text = await source('supabase/functions/kaggle-worker-source-v58/index.ts');
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
  assert.match(text, /git','-C',str\(repo\),'fetch','--depth','1','origin',ACE_REVISION/);
  assert.match(text, /uv','sync','--frozen','--no-dev','--python','3\.11'/);
  assert.match(text, /prefer_source='modelscope'/);
  assert.match(text, /thinking=False/);
  assert.match(text, /task_type='text2music'/);
  assert.match(text, /task_type='repaint'/);
  assert.match(text, /src_audio=os\.environ\['PV_SOURCE_AUDIO'\]/);
  assert.match(text, /repainting_start/);
  assert.match(text, /repainting_end/);
  assert.match(text, /chunk_mask_mode/);
  assert.match(text, /repaint_source_sha256_mismatch/);
  assert.match(text, /repaint_output_duration_mismatch/);
  assert.match(text, /audio_format='flac'/);
  assert.match(text, /sha256_file/);
  assert.match(text, /ffprobe/);
  assert.match(text, /upload_to_signed_url/);
  assert.match(text, /callback_token/);
  assert.doesNotMatch(text, /KAGGLE_KEY|KAGGLE_USERNAME|service_role/i);
});

test('native callback verifies source identity and repaint range before persisting a new full mix', async () => {
  const text = await source('supabase/functions/complete-kaggle-pipeline-job-v58/index.ts');
  assert.match(text, /\['music_generation','music_repaint'\]/);
  assert.match(text, /task_type_mismatch/);
  assert.match(text, /sha256Text\(token\)/);
  assert.match(text, /callback_token_expired/);
  assert.match(text, /engine_identity_mismatch/);
  assert.match(text, /source_asset_proof_mismatch/);
  assert.match(text, /source_sha256_proof_mismatch/);
  assert.match(text, /repaint_range_proof_mismatch/);
  assert.match(text, /repaint_duration_proof_mismatch/);
  assert.match(text, /audio-private/);
  assert.match(text, /kind:'full_mix'/);
  assert.match(text, /section_repaint_reference_mix/);
  assert.match(text, /sha256:audioSha/);
  assert.match(text, /proof:any=\{verified:true/);
  assert.match(text, /status:'finalizing'/);
  assert.match(text, /status:'completed'/);
  assert.match(text, new RegExp(REVISION));
  assert.match(text, new RegExp(MODEL));
});

test('browser runtime addresses only owned RLS rows and verifies downloaded bytes for generation and repaint', async () => {
  const resultRuntime = await source('packages/app/native-music-result-runtime.mjs');
  const generationClient = await source('packages/app/native-music-generation-client.mjs');
  const repaintClient = await source('packages/app/native-music-section-repaint-client.mjs');
  assert.match(resultRuntime, /authorization = `Bearer \$\{token\}`/);
  assert.match(resultRuntime, /MUSIC_JOB_TYPES = new Set\(\['music_generation', 'music_repaint'\]\)/);
  assert.match(resultRuntime, /music_repaint_proof_missing/);
  assert.match(resultRuntime, /asset\.kind !== 'full_mix'/);
  assert.match(resultRuntime, /asset\.storage_bucket !== 'audio-private'/);
  assert.match(resultRuntime, /music_sha256_mismatch/);
  assert.match(resultRuntime, /music_size_mismatch/);
  for (const client of [generationClient, repaintClient]) {
    assert.match(client, /compute-kaggle-v58/);
    assert.match(client, /ensureRemoteProject/);
    assert.match(client, /ensureSession/);
    assert.match(client, /fallback_allowed: false/);
    assert.doesNotMatch(client, /ELEVENLABS_API_KEY|KAGGLE_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  }
  assert.match(repaintClient, /operation: 'repaint'/);
  assert.match(repaintClient, /source_asset_id/);
  assert.match(repaintClient, /expectedJobType: 'music_repaint'/);
});
