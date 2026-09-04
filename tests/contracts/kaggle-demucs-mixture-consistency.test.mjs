import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeKaggleStemCompletion } from '../../services/providers/kaggle-demucs.mjs';

const METHOD = 'mixture_residual_source_minus_vocals_v1';
const proof = {
  source_sha256: '1'.repeat(64),
  vocal_sha256: '2'.repeat(64),
  instrumental_sha256: '3'.repeat(64),
  vocal_size_bytes: 8192,
  instrumental_size_bytes: 16384,
  demucs_version: '4.0.1',
  instrumental_method: METHOD,
};

test('B09 accepts only retained mixture-consistent instrumental proof', () => {
  const normalized = normalizeKaggleStemCompletion(proof);
  assert.equal(normalized.validatedOutput, true);
  assert.equal(normalized.instrumentalMethod, METHOD);
  assert.equal(normalized.model, 'htdemucs');
  assert.equal(normalized.version, '4.0.1');
});

test('B09 rejects legacy two-stem proof that does not conserve the mixture', () => {
  assert.throws(
    () => normalizeKaggleStemCompletion({ ...proof, instrumental_method: undefined }),
    /mixture-consistent instrumental method is required/,
  );
});

test('standalone worker derives instrumental from source minus the retained vocal estimate', async () => {
  const worker = await readFile(new URL('../../supabase/functions/kaggle-stems-worker/index.ts', import.meta.url), 'utf8');
  assert.match(worker, /INSTRUMENTAL_METHOD = 'mixture_residual_source_minus_vocals_v1'/);
  assert.match(worker, /amix=inputs=2:weights='1 -1':normalize=0:duration=first/);
  assert.match(worker, /build_mixture_consistent_instrumental\(src,vocal,inst\)/);
  assert.match(worker, /'instrumental_method':INSTRUMENTAL_METHOD/);
});

test('callback binds the mixture-consistency method into persisted proof', async () => {
  const callback = await readFile(new URL('../../supabase/functions/complete-kaggle-stems-job/index.ts', import.meta.url), 'utf8');
  assert.match(callback, /REQUIRED_INSTRUMENTAL_METHOD = 'mixture_residual_source_minus_vocals_v1'/);
  assert.match(callback, /instrumental_method:instrumentalMethod/);
  assert.match(callback, /instrumental_method_mismatch/);
});
