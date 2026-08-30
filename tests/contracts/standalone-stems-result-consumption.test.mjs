import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const runtime = await readFile(new URL('../../packages/app/stems-result-runtime.mjs', import.meta.url), 'utf8');
const canary = await readFile(new URL('../../packages/app/stems-canary.mjs', import.meta.url), 'utf8');

test('standalone stems are read only through authenticated job and asset ownership paths', () => {
  assert.match(runtime, /rest\/v1\/render_jobs/);
  assert.match(runtime, /authorization = `Bearer \$\{token\}`/);
  assert.match(runtime, /job\.job_type !== 'stems'/);
  assert.match(runtime, /job\.output_asset_ids\.length !== 2/);
  assert.match(runtime, /String\(asset\.project_id\) !== String\(job\.project_id\)/);
  assert.doesNotMatch(runtime, /service_role/i);
});

test('private outputs must retain canonical pair and pass byte-level SHA-256 verification', () => {
  assert.match(runtime, /EXPECTED_KINDS = new Set\(\['guide_vocal', 'instrumental'\]\)/);
  assert.match(runtime, /asset\.storage_bucket !== 'audio-private'/);
  assert.match(runtime, /storage\/v1\/object\/authenticated/);
  assert.match(runtime, /blob\.size !== Number\(asset\.size_bytes\)/);
  assert.match(runtime, /stem_sha256_mismatch/);
  assert.match(runtime, /crypto\.subtle\.digest\('SHA-256'/);
});

test('completed outputs are durably promoted into the same local project', () => {
  assert.match(runtime, /saveAudioAsset/);
  assert.match(runtime, /createTrack/);
  assert.match(runtime, /renderJobId: job\.id/);
  assert.match(runtime, /remoteAssetId: remoteAsset\.id/);
  assert.match(runtime, /remoteProjectId: job\.project_id/);
  assert.match(runtime, /remoteSha256: downloaded\.sha256/);
  assert.match(runtime, /await saveProject\(project\)/);
  assert.match(canary, /waitForStandaloneStems/);
  assert.match(canary, /importStandaloneStems/);
  assert.match(canary, /stems:consumed\.imported/);
});

test('standalone route validation is distinct from B09 acoustic promotion', () => {
  assert.match(canary, /routeValidated:true/);
  assert.match(canary, /b09AcousticValidated:false/);
  assert.match(canary, /dispatcher:DISPATCHER,engine:'Demucs',model:'htdemucs'/);
  assert.doesNotMatch(canary, /B09_STANDALONE_STEMS_PASSED/);
});
