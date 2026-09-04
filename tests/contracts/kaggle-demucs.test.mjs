import test from 'node:test';
import assert from 'node:assert/strict';
import { kaggleDemucsProvider, normalizeKaggleStemCompletion, validateKaggleStemTicket } from '../../services/providers/kaggle-demucs.mjs';

const sha = (char) => char.repeat(64);
const INSTRUMENTAL_METHOD = 'mixture_residual_source_minus_vocals_v1';

function ticket() {
  return {
    job_type: 'stems',
    job_id: 'job-1',
    expires_at: Math.floor(Date.now() / 1000) + 600,
    source_url: 'https://example.test/private/source.wav',
    source_sha256: sha('a'),
    complete_url: 'https://example.test/complete',
    callback_token: 'callback-token',
    supabase_url: 'https://example.supabase.co',
    supabase_publishable_key: 'publishable-key',
    outputs: {
      vocal: { bucket: 'private', path: 'jobs/job-1/vocal.wav', token: 'token-v' },
      instrumental: { bucket: 'private', path: 'jobs/job-1/instrumental.wav', token: 'token-i' },
    },
  };
}

test('recovered Kaggle stem ticket contract accepts signed private-job shape', () => {
  assert.equal(validateKaggleStemTicket(ticket()), true);
});

test('Kaggle completion records Demucs provenance and independent mixture-consistent SHA proof', () => {
  const proof = normalizeKaggleStemCompletion({
    source_sha256: sha('a'),
    vocal_sha256: sha('b'),
    instrumental_sha256: sha('c'),
    vocal_size_bytes: 5000,
    instrumental_size_bytes: 6000,
    demucs_version: '4.0.1',
    instrumental_method: INSTRUMENTAL_METHOD,
  });
  assert.equal(proof.provider, 'demucs');
  assert.equal(proof.model, 'htdemucs');
  assert.equal(proof.instrumentalMethod, INSTRUMENTAL_METHOD);
  assert.equal(proof.validatedOutput, true);
});

test('Kaggle completion rejects fake identical or tiny stems', () => {
  assert.throws(() => normalizeKaggleStemCompletion({
    source_sha256: sha('a'), vocal_sha256: sha('a'), instrumental_sha256: sha('c'),
    vocal_size_bytes: 5000, instrumental_size_bytes: 6000, demucs_version: '4.0.1', instrumental_method: INSTRUMENTAL_METHOD,
  }), /hashes/);
  assert.throws(() => normalizeKaggleStemCompletion({
    source_sha256: sha('a'), vocal_sha256: sha('b'), instrumental_sha256: sha('c'),
    vocal_size_bytes: 4096, instrumental_size_bytes: 6000, demucs_version: '4.0.1', instrumental_method: INSTRUMENTAL_METHOD,
  }), /too small/);
});

test('provider stays non-promotable until ticket and completion adapters are wired and validated', () => {
  const disconnected = kaggleDemucsProvider();
  assert.equal(disconnected.available, false);
  assert.equal(disconnected.validated, false);
  const connectedButUnvalidated = kaggleDemucsProvider({ issueTicket() {}, awaitCompletion() {} });
  assert.equal(connectedButUnvalidated.available, true);
  assert.equal(connectedButUnvalidated.validated, false);
});
