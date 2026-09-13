import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) { return readFile(new URL(`../../${path}`, import.meta.url), 'utf8'); }

test('music generation persists one queued job before trying to acquire GPU capacity', async () => {
  const dispatcher = await source('supabase/functions/compute-kaggle-v58/index.ts');
  const insertAt = dispatcher.indexOf("status:'queued',progress:5");
  const dispatchAt = dispatcher.indexOf('const result=await dispatchQueuedJob(env,jobId)');
  assert.ok(insertAt >= 0 && dispatchAt > insertAt, 'render job must exist before GPU dispatch is attempted');
  assert.match(dispatcher, /queue_schema:'pablovoice_music_queue_v1'/);
  assert.match(dispatcher, /queue_request:\{generation,allow_shared_compute:/);
  assert.match(dispatcher, /if\(!leaseHeld\)return \{ok:true,queued:true/);
  assert.match(dispatcher, /status:'queued',progress:5,current_stage:'gpu_capacity'/);
  assert.match(dispatcher, /return json\(\{\.\.\.result,queue_position:position,human_message:'Sua música está na fila e será iniciada automaticamente\.'\},202\)/);
  assert.doesNotMatch(dispatcher, /error:'music_compute_busy'.*429/);
});

test('queue dispatcher is FIFO, resumable and internally authenticated', async () => {
  const dispatcher = await source('supabase/functions/compute-kaggle-v58/index.ts');
  assert.match(dispatcher, /async function dispatchNextQueued/);
  assert.match(dispatcher, /\.eq\('job_type','music_generation'\)\.eq\('status','queued'\)/);
  assert.match(dispatcher, /\.order\('created_at',\{ascending:true\}\)/);
  assert.match(dispatcher, /body\?\.action==='dispatch_next'/);
  assert.match(dispatcher, /internalDispatchAllowed/);
  assert.match(dispatcher, /validate_music_dispatch_token/);
  assert.match(dispatcher, /x-pv-dispatch-token/);
  assert.match(dispatcher, /body\?\.action==='dispatch_job'/);
  assert.match(dispatcher, /\.eq\('user_id',user\.id\)\.eq\('job_type','music_generation'\)/);
});

test('database queue survives idle capacity and cron securely nudges the dispatcher', async () => {
  const migration = await source('supabase/migrations/20260913204500_music_generation_persistent_queue.sql');
  assert.match(migration, /render_jobs_music_generation_queue_idx/);
  assert.match(migration, /where job_type='music_generation'\s+and status='queued'/);
  assert.match(migration, /vault\.create_secret/);
  assert.match(migration, /pablovoice_music_dispatcher_token/);
  assert.match(migration, /validate_music_dispatch_token/);
  assert.match(migration, /revoke all on function public\.validate_music_dispatch_token\(text\) from public, anon, authenticated/);
  assert.match(migration, /cron\.schedule\(/);
  assert.match(migration, /pablovoice-music-dispatch-queue/);
  assert.match(migration, /net\.http_post/);
  assert.match(migration, /x-pv-dispatch-token/);
  assert.match(migration, /\{\"action\":\"dispatch_next\"\}/);
  const watchdogList = migration.match(/and status in \(([^)]+)\)/)?.[1] || '';
  assert.ok(watchdogList, 'watchdog status list must remain explicit');
  assert.doesNotMatch(watchdogList, /'queued'/, 'intentionally queued music must not become heartbeat-stalled');
});

test('completion and worker error both release GPU capacity and kick the next queued job', async () => {
  const complete = await source('supabase/functions/complete-kaggle-pipeline-job-v58/index.ts');
  const progress = await source('supabase/functions/progress-kaggle-pipeline-job-v58/index.ts');
  for (const text of [complete, progress]) {
    assert.match(text, /release_music_generation_dispatch_lease/);
    assert.match(text, /action:'dispatch_next'/);
    assert.match(text, /compute-kaggle-v58/);
  }
  assert.match(complete, /await releaseLease\(admin,jobId\)\s+await kickNext\(supabaseUrl,adminKey\)/);
  assert.match(progress, /if\(!retry\)\{await releaseLease\(admin,job\);await kickNext\(url,secret,job\)\}/);
});
