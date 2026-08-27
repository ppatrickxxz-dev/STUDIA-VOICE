import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('sampler boots in the canonical shell and reuses the shared audio analyzer', async () => {
  const [preboot, sampler, pianoBridge, sharedAnalyzer] = await Promise.all([
    read('packages/app/preboot.mjs'),
    read('packages/app/sampler-ui.mjs'),
    read('packages/app/audio-to-piano-roll-ui.mjs'),
    read('packages/app/audio-analysis-runtime.mjs'),
  ]);

  assert.match(preboot, /installSampler/);
  assert.match(preboot, /sampler-ui\.mjs/);
  assert.match(sampler, /analyzeAudioTrack/);
  assert.doesNotMatch(sampler, /detectOnsets/);
  assert.match(pianoBridge, /analyzeAudioTrack/);
  assert.doesNotMatch(pianoBridge, /detectOnsets/);
  assert.match(sharedAnalyzer, /detectOnsets/);
});

test('slice pads reference the original project asset and persist edits instead of copying blobs', async () => {
  const [sampler, engine] = await Promise.all([
    read('packages/app/sampler-ui.mjs'),
    read('packages/app/sampler-engine.mjs'),
  ]);

  assert.match(sampler, /getAudioAsset/);
  assert.match(sampler, /activeProject\.sampler = samplerState/);
  assert.match(sampler, /saveProject\(activeProject\)/);
  assert.doesNotMatch(sampler, /saveAudioAsset/);
  assert.match(engine, /sourceAssetId/);
  assert.match(engine, /fadeIn/);
  assert.match(engine, /fadeOut/);
  assert.match(engine, /gain/);
});

test('sampler audition uses source offsets for real slice playback', async () => {
  const sampler = await read('packages/app/sampler-ui.mjs');
  assert.match(sampler, /createBufferSource/);
  assert.match(sampler, /source\.start\(0, Math\.max\(0, pad\.start\), duration\)/);
  assert.match(sampler, /linearRampToValueAtTime/);
});
