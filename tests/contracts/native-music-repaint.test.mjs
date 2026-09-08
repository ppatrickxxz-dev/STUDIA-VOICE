import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const REVISION = 'ca1e85fe9430179831e6bc6be790c332190a3866';

test('dispatcher resolves an owned private full_mix source and signs it only for the GPU ticket', async () => {
  const text = await read('supabase/functions/compute-kaggle-v58/index.ts');
  assert.match(text, /action==='repaint'/);
  assert.match(text, /jobType='music_repaint'/);
  assert.match(text, /source_asset_id/);
  assert.match(text, /sourceAsset\.kind!=='full_mix'/);
  assert.match(text, /sourceAsset\.storage_bucket!=='audio-private'/);
  assert.match(text, /createSignedUrl\(sourceAsset\.storage_path,5400/);
  assert.match(text, /inputAssetIds=\[sourceAsset\.id\]/);
  assert.match(text, /repaint_mode:repaint\.mode/);
  assert.match(text, new RegExp(REVISION));
  assert.doesNotMatch(text, /service_role[^\n]*ticket/i);
});

test('worker pins repaint to explicit interval, heartbeats during long GPU startup, and proves unchanged PCM outside it', async () => {
  const text = await read('supabase/functions/kaggle-worker-source-v58/index.ts');
  assert.match(text, /task_type='repaint'/);
  assert.match(text, /src_audio=src/);
  assert.match(text, /repainting_start/);
  assert.match(text, /repainting_end/);
  assert.match(text, /chunk_mask_mode='explicit'/);
  assert.match(text, /repaint_mode/);
  assert.match(text, /repaint_strength/);
  assert.match(text, /repaint_latent_crossfade_frames/);
  assert.match(text, /repaint_wav_crossfade_sec/);
  assert.match(text, /enable_normalization=False/);
  assert.match(text, /PROGRESS_SLUG = 'progress-kaggle-pipeline-job-v58'/);
  assert.match(text, /'stage':'heartbeat'/);
  assert.match(text, /while not stop\.wait\(45\)/);
  assert.match(text, /threading\.Thread\(target=heartbeat_loop/);
  assert.match(text, /repaint_source_sha256_mismatch/);
  assert.match(text, /pcm_hash_range/);
  assert.match(text, /repaint_outside_changed_/);
  assert.match(text, /preserved_outside_verified/);
  assert.match(text, new RegExp(REVISION));
});

test('callback refuses repaint unless source identity, duration, range and outside PCM proof all agree, including stalled recovery', async () => {
  const text = await read('supabase/functions/complete-kaggle-pipeline-job-v58/index.ts');
  assert.match(text, /MUSIC_JOB_TYPES=new Set\(\['music_generation','music_repaint'\]\)/);
  assert.match(text, /CALLBACK_STATES=new Set\(\['waiting_kaggle','stalled'\]\)/);
  assert.match(text, /\.eq\('status',callbackState\)/);
  assert.match(text, /repaint_source_job_mismatch/);
  assert.match(text, /repaint_source_sha_mismatch/);
  assert.match(text, /repaint_duration_mismatch/);
  assert.match(text, /repaint_range_mismatch/);
  assert.match(text, /repaint_outside_preservation_failed/);
  assert.match(text, /source_pcm_sha256===w\.output_pcm_sha256/);
  assert.match(text, /purpose=jobType==='music_repaint'\?'section_repaint_reference_mix'/);
  assert.match(text, /preserved_outside_verified:true/);
  assert.match(text, /recovered_from_stalled:callbackState==='stalled'/);
});

test('app is native-first but retains old song-id projects without silent local fallback', async () => {
  const [resolver, runtime, client] = await Promise.all([
    read('packages/app/music-section-regeneration.mjs'),
    read('packages/app/section-regeneration-runtime.mjs'),
    read('packages/app/native-music-generation-client.mjs'),
  ]);
  assert.match(resolver, /sourceProvider = sourceAssetId \? 'pablovoice_native_repaint'/);
  assert.match(runtime, /nativeFirst: true/);
  assert.match(runtime, /legacySongIdCompatibility: true/);
  assert.match(runtime, /silentLocalFallback: false/);
  assert.match(runtime, /repaintSection/);
  assert.match(client, /expectedJobType: 'music_repaint'/);
  assert.match(client, /action: 'repaint'/);
  assert.match(client, /source_asset_id/);
  assert.match(client, /invalid_repaint_range/);
});
