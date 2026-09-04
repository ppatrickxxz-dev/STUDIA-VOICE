import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeKaggleStemCompletion } from '../../services/providers/kaggle-demucs.mjs';

const METHOD = 'mixture_residual_pcm48_mono_source_minus_vocals_v2';
const proof = {
  source_sha256: '1'.repeat(64),
  vocal_sha256: '2'.repeat(64),
  instrumental_sha256: '3'.repeat(64),
  vocal_size_bytes: 8192,
  instrumental_size_bytes: 16384,
  demucs_version: '4.0.1',
  instrumental_method: METHOD,
  pcm_domain: 'mono_48000_f32',
};

test('B09 accepts only retained explicit PCM-domain mixture-consistent proof', () => {
  const normalized = normalizeKaggleStemCompletion(proof);
  assert.equal(normalized.validatedOutput, true);
  assert.equal(normalized.instrumentalMethod, METHOD);
  assert.equal(normalized.pcmDomain, 'mono_48000_f32');
  assert.equal(normalized.model, 'htdemucs');
  assert.equal(normalized.version, '4.0.1');
});

test('B09 rejects legacy residual proof that did not subtract in PCM space', () => {
  assert.throws(
    () => normalizeKaggleStemCompletion({ ...proof, instrumental_method: 'mixture_residual_source_minus_vocals_v1' }),
    /explicit PCM48 mixture-consistent instrumental method is required/,
  );
});

test('standalone worker normalizes both stems to the validator domain and performs arithmetic subtraction', async () => {
  const worker = await readFile(new URL('../../supabase/functions/kaggle-stems-worker/index.ts', import.meta.url), 'utf8');
  assert.match(worker, /INSTRUMENTAL_METHOD = 'mixture_residual_pcm48_mono_source_minus_vocals_v2'/);
  assert.match(worker, /PCM_RATE = 48000/);
  assert.match(worker, /'-ac','1','-ar',str\(PCM_RATE\),'-f','f32le'/);
  assert.match(worker, /residual=array\('f',\(source_values\[i\]-vocal_values\[i\]/);
  assert.doesNotMatch(worker, /amix=inputs=2:weights='1 -1'/);
  assert.match(worker, /build_mixture_consistent_stems\(src,demucs_vocal,vocal,inst,tmp\)/);
  assert.match(worker, /'instrumental_method':INSTRUMENTAL_METHOD/);
});

test('callback binds PCM-domain provenance into persisted proof', async () => {
  const callback = await readFile(new URL('../../supabase/functions/complete-kaggle-stems-job/index.ts', import.meta.url), 'utf8');
  assert.match(callback, /REQUIRED_INSTRUMENTAL_METHOD = 'mixture_residual_pcm48_mono_source_minus_vocals_v2'/);
  assert.match(callback, /pcm_domain:'mono_48000_f32'/);
  assert.match(callback, /sample_rate:48000,channels:1/);
  assert.match(callback, /instrumental_method_mismatch/);
});
