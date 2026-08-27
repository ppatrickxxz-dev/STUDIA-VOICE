import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AudioAnalysisBus,
  analysisCacheKey,
  createAnalysisRecord,
  mergeAnalysis,
  validateAnalysisRecord
} from '../../packages/audio/src/analysis-bus.mjs';
import {
  ENGINE_KINDS,
  canExposeCapability,
  providerCapability,
  technicalRecipe
} from '../../packages/audio/src/engine-contracts.mjs';

test('analysis record starts explicitly unmeasured instead of inventing metrics', () => {
  const record = createAnalysisRecord({ assetId: 'asset-1', sampleRate: 48000, channels: 2, durationSeconds: 10 });
  assert.equal(record.music.bpm, null);
  assert.equal(record.signal.loudnessLufs, null);
  assert.equal(record.voice.pitchHz, null);
  assert.equal(record.provenance.measured, false);
  assert.equal(validateAnalysisRecord(record), true);
});

test('analysis merges measured data without replacing unrelated domains', () => {
  const base = createAnalysisRecord({ assetId: 'asset-1' });
  const next = mergeAnalysis(base, { music: { bpm: 96, bpmConfidence: .91 }, signal: { clippingRatio: 0 } }, {
    analyzer: 'pv-analysis-test', analyzerVersion: '1', measured: true
  });
  assert.equal(next.music.bpm, 96);
  assert.equal(next.music.bpmConfidence, .91);
  assert.equal(next.signal.clippingRatio, 0);
  assert.deepEqual(next.voice.pitchContour, []);
  assert.equal(next.provenance.measured, true);
});

test('analysis bus persists once and fans the same result to consumers', async () => {
  const persisted = new Map();
  const bus = new AudioAnalysisBus({ load: async (key) => persisted.get(key), save: async (key, value) => persisted.set(key, value) });
  const key = analysisCacheKey({ assetId: 'asset-2', sourceVersion: 3, recipeVersion: 'aab-v1' });
  const seen = [];
  bus.subscribe(key, (record) => seen.push(record.music.bpm));
  const record = mergeAnalysis(createAnalysisRecord({ assetId: 'asset-2', sourceVersion: 3 }), { music: { bpm: 120 } }, { measured: true });
  await bus.put(key, record);
  assert.equal((await bus.get(key)).music.bpm, 120);
  assert.deepEqual(seen, [120]);
});

test('provider capability is hidden until both available and validated', () => {
  const candidate = providerCapability({ kind: ENGINE_KINDS.STEM, provider: 'demucs', version: '4.0.1', available: true, validated: false });
  assert.equal(canExposeCapability(candidate), false);
  const validated = { ...candidate, validated: true };
  assert.equal(canExposeCapability(validated), true);
});

test('technical recipe captures reproducibility fields without secrets', () => {
  const recipe = technicalRecipe({ provider: 'rvc', providerVersion: 'pinned', model: 'Pablo Voice Natural', modelVersion: 'sha256:test', runtime: { torch: '2.x', ffmpeg: 'pinned' }, parameters: { protect: .45 } });
  assert.equal(recipe.provider, 'rvc');
  assert.equal(recipe.runtime.torch, '2.x');
  assert.equal(recipe.parameters.protect, .45);
});
