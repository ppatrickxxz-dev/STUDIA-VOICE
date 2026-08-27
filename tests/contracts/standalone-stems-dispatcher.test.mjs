import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dispatcher=fs.readFileSync(new URL('../../supabase/functions/compute-kaggle-stems/index.ts',import.meta.url),'utf8');
const worker=fs.readFileSync(new URL('../../supabase/functions/kaggle-stems-worker/index.ts',import.meta.url),'utf8');

test('standalone dispatcher authenticates user and reuses canonical ticket issuer',()=>{
  assert.match(dispatcher,/auth\.getUser\(jwt\)/);
  assert.match(dispatcher,/create-kaggle-ticket/);
  assert.match(dispatcher,/job_type:'stems'/);
  assert.match(dispatcher,/admin_get_compute_connection/);
  assert.match(dispatcher,/SaveKernel/);
});

test('dispatcher never serializes service role into the Kaggle ticket bootstrap',()=>{
  assert.doesNotMatch(dispatcher,/SERVICE_ROLE_KEY[^\n]*TICKET_B64/);
  assert.match(dispatcher,/TICKET_B64/);
  assert.match(dispatcher,/kaggle-stems-worker/);
});

test('worker verifies source and separated hashes before upload and callback',()=>{
  assert.match(worker,/source_sha256_mismatch/);
  assert.match(worker,/proof_gate_failed/);
  assert.match(worker,/stem_too_small/);
  assert.match(worker,/upload_to_signed_url/);
  assert.match(worker,/complete_url/);
  assert.match(worker,/demucs==4\.0\.1/);
  assert.match(worker,/--two-stems=vocals/);
  assert.match(worker,/htdemucs/);
});

test('worker uses only ticket-scoped publishable key and signed upload tokens',()=>{
  assert.match(worker,/supabase_publishable_key/);
  assert.match(worker,/output\['token'\]/);
  assert.doesNotMatch(worker,/service_role/i);
});
