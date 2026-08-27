import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisRecordV2, invalidateRange, clearInvalidatedRanges } from '../src/contracts/analysis-v2.mjs';
import { confidenceDecision } from '../src/contracts/confidence.mjs';
import { analyzeWaveform } from '../src/analyzers/waveform-basic.mjs';
import { detectOnsets } from '../src/analyzers/onset-basic.mjs';

test('analysis v2 creates reusable canonical state', () => {
  const record = createAnalysisRecordV2({ assetId: 'asset-1', sampleRate: 48000, channels: 1, durationSeconds: 2 });
  assert.equal(record.schemaVersion, 2);
  assert.ok(Array.isArray(record.music.noteEvents));
  assert.ok(Array.isArray(record.voice.formants));
});

test('range invalidation preserves non-destructive semantics', () => {
  const record = createAnalysisRecordV2({ assetId: 'asset-2' });
  invalidateRange(record, { startSeconds: 1, endSeconds: 2, features: ['voice.pitchContour'] });
  assert.equal(record.validity.invalidatedRanges.length, 1);
  clearInvalidatedRanges(record);
  assert.equal(record.validity.complete, true);
});

test('confidence gate distinguishes execution modes', () => {
  assert.equal(confidenceDecision(0.9), 'auto');
  assert.equal(confidenceDecision(0.6), 'suggest');
  assert.equal(confidenceDecision(0.2), 'manual');
});

test('waveform analyzer measures deterministic signal facts', () => {
  const out = analyzeWaveform(Float32Array.from([0, 0.5, -1, 0.5, 0]), { sampleRate: 5 });
  assert.equal(out.durationSeconds, 1);
  assert.equal(out.signal.peak.value, 1);
  assert.ok(out.signal.rms.value > 0);
});

test('onset detector returns event objects', () => {
  const samples = new Float32Array(8192);
  for (let i = 4096; i < 4608; i += 1) samples[i] = 1;
  const events = detectOnsets(samples, { sampleRate: 48000, threshold: 0.5 });
  assert.ok(Array.isArray(events));
});
