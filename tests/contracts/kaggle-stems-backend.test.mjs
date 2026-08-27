import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KaggleStemsClient, validateIssuedStemsTicket } from '../../services/providers/kaggle-stems-client.mjs';

const sha = 'a'.repeat(64);
const projectId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

function ticket(now = 1000) {
  return {
    ok: true,
    job_id: jobId,
    ticket: {
      job_type: 'stems',
      job_id: jobId,
      expires_at: now + 100,
      source_url: 'https://example.com/source.wav',
      source_sha256: sha,
      supabase_url: 'https://project.supabase.co',
      complete_url: 'https://project.supabase.co/functions/v1/complete-kaggle-stems-job',
      callback_token: 'x'.repeat(40),
      outputs: {
        vocal: { bucket: 'audio-private', path: 'u/p/stems/vocal.wav', token: 'vocal-token' },
        instrumental: { bucket: 'audio-private', path: 'u/p/stems/instrumental.wav', token: 'inst-token' },
      },
      profile: { name: 'htdemucs', two_stems: 'vocals' },
    },
  };
}

test('issued stems ticket validates only with expected proof fields and HTTPS endpoints', () => {
  const result = validateIssuedStemsTicket(ticket(), 1000);
  assert.equal(result.provider, 'demucs');
  assert.equal(result.model, 'htdemucs');
  assert.equal(result.jobId, jobId);
});

test('client requests only authenticated stems ticket and does not require service-role credentials', async () => {
  let request;
  const client = new KaggleStemsClient({
    supabaseUrl: 'https://project.supabase.co',
    publishableKey: 'publishable',
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200, async text() { return JSON.stringify(ticket(Math.floor(Date.now()/1000))); } };
    },
  });
  await client.createTicket({ accessToken: 'user-jwt', projectId });
  const body = JSON.parse(request.init.body);
  assert.equal(body.job_type, 'stems');
  assert.equal(body.project_id, projectId);
  assert.equal(request.init.headers.authorization, 'Bearer user-jwt');
  assert.equal('service_role' in request.init.headers, false);
});

test('canonical Supabase sources preserve callback-hash and proof gates', async () => {
  const issuer = await readFile(new URL('../../supabase/functions/create-kaggle-ticket/index.ts', import.meta.url), 'utf8');
  const completion = await readFile(new URL('../../supabase/functions/complete-kaggle-stems-job/index.ts', import.meta.url), 'utf8');
  assert.match(issuer, /kaggle_callback_hash:callbackHash/);
  assert.match(issuer, /createSignedUploadUrl/);
  assert.match(issuer, /job_type:'stems'/);
  assert.match(completion, /proof_gate_failed/);
  assert.match(completion, /output_object_not_found/);
  assert.match(completion, /metadata:\{engine:'Demucs',model:'htdemucs'/);
  assert.match(completion, /delete cleaned\.kaggle_callback_hash/);
});
