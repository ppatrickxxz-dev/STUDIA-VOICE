import test from 'node:test';
import assert from 'node:assert/strict';
import { attachAnalysisV2 } from '../../packages/audio/src/analysis-v2-adapter.mjs';

test('v2 adapter enriches existing record without mutating it', () => {
  const base = { assetId: 'asset1', music: { bpm: null }, voice: { pitchHz: null } };
  const result = attachAnalysisV2(base, { music: { bpm: 120 }, voice: { pitchHz: 440 }, confidence: { pitch: 0.9 } });
  assert.equal(base.music.bpm, null);
  assert.equal(result.music.bpm, 120);
  assert.equal(result.voice.pitchHz, 440);
  assert.equal(result.analysisV2.confidence.pitch, 0.9);
});
