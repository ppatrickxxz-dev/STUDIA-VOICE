import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}
async function computeSource() {
  const root = 'supabase/functions/compute-kaggle-v58/';
  return (await Promise.all(['index.ts','core.ts','handler.ts'].map((file) => source(`${root}${file}`)))).join('\n');
}

const compute = await computeSource();
const complete = await source('supabase/functions/complete-kaggle-pipeline-job-v58/index.ts');
const progress = await source('supabase/functions/progress-kaggle-pipeline-job-v58/index.ts');

test('server handoff can select only the oldest durable queued music job with the service API key', () => {
  assert.match(compute, /const internalHandoff=body\?\.resume_next===true&&\(req\.headers\.get\('apikey'\)\|\|''\)===secret/);
  assert.match(compute, /\.eq\('job_type','music_generation'\)\.eq\('status','queued_capacity'\)\.is\('finished_at',null\)/);
  assert.match(compute, /\.order\('created_at',\{ascending:true\}\)\.order\('id',\{ascending:true\}\)\.limit\(1\)/);
  assert.match(compute, /admin\.auth\.admin\.getUserById\(String\(next\.user_id\)\)/);
  assert.match(compute, /status:'queue_empty',server_handoff:true/);
});

test('public user resume remains owner scoped and service handoff does not bypass project ownership', () => {
  assert.match(compute, /\.eq\('id',resumeJobId\)\.eq\('user_id',user\.id\)\.eq\('job_type','music_generation'\)/);
  assert.match(compute, /\.eq\('id',projectId\)\.eq\('user_id',user\.id\)/);
  assert.match(compute, /if\(!jwt\)return json\(\{ok:false,error:'connection_required'\},401\)/);
  assert.doesNotMatch(compute, /authorization:`Bearer \$\{secret\}`/);
});

test('completion releases the current GPU lease before handing capacity to the next queued job', () => {
  const releaseAt = complete.indexOf('await releaseLease(admin,jobId)');
  const kickAt = complete.indexOf('await kickNext(supabaseUrl,adminKey)');
  assert.ok(releaseAt >= 0 && kickAt > releaseAt, 'GPU lease must be released before queue handoff');
  assert.match(complete, /headers:\{apikey:secret,'content-type':'application\/json'\}/);
  assert.match(complete, /JSON\.stringify\(\{resume_next:true\}\)/);
  assert.doesNotMatch(complete, /Authorization.*secret/i);
});

test('terminal music worker errors release capacity and continue the queue, while non-music retry behavior stays unchanged', () => {
  assert.match(progress, /const retry=job\.job_type!=='music_generation'&&!!c\.transient/);
  assert.match(progress, /if\(!retry\)\{await releaseLease\(admin,job\);await kickNext\(url,secret,job\)\}/);
  assert.match(progress, /if\(job\?\.job_type!=='music_generation'\)return/);
  assert.match(progress, /headers:\{apikey:secret,'content-type':'application\/json'\}/);
  assert.doesNotMatch(progress, /Authorization.*secret/i);
});
