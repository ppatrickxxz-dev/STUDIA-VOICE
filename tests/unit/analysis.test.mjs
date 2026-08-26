import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAudioBuffer, analysisIsMeasured, AUDIO_ANALYSIS_ENGINE } from '../../packages/analysis/src/analyzer.mjs';

function fakeBuffer(channels, sampleRate = 1000) {
  const data = channels.map((values) => Float32Array.from(values));
  return {
    numberOfChannels: data.length,
    sampleRate,
    length: data[0].length,
    getChannelData: (index) => data[index],
  };
}

test('analysis measures peak, RMS, clipping and source provenance without inventing MIR fields', () => {
  const buffer = fakeBuffer([[0, 0.5, -1, 1]], 1000);
  const result = analyzeAudioBuffer(buffer, { measuredAt: 1234, windowMs: 10, silenceThresholdDb: -50 });

  assert.equal(result.engine, AUDIO_ANALYSIS_ENGINE);
  assert.equal(result.measuredAt, 1234);
  assert.equal(result.provenance.kind, 'measured');
  assert.deepEqual(result.source, { sampleRate: 1000, channels: 1, frames: 4, durationSeconds: 0.004 });
  assert.equal(result.measurements.peakLinear, 1);
  assert.equal(result.measurements.peakDbFS, 0);
  assert.equal(result.measurements.clippedSamples, 2);
  assert.equal(result.measurements.clippingSampleRatio, 0.5);
  assert.equal(result.unavailable.bpm, 'ENGINE_NOT_CONFIGURED');
  assert.equal(result.unavailable.pitchContour, 'ENGINE_NOT_CONFIGURED');
  assert.equal(analysisIsMeasured(result), true);
});

test('analysis detects fully silent audio conservatively', () => {
  const result = analyzeAudioBuffer(fakeBuffer([[0, 0, 0, 0]], 1000), { measuredAt: 1, windowMs: 10 });
  assert.equal(result.measurements.peakDbFS, -120);
  assert.equal(result.measurements.rmsDbFS, -120);
  assert.equal(result.measurements.silenceWindowRatio, 1);
  assert.equal(result.measurements.clippedSamples, 0);
  assert.equal(result.measurements.dynamicRangeDb, 0);
});

test('analysis handles stereo PCM and reports bounded ratios', () => {
  const left = Array.from({ length: 100 }, (_, index) => index < 50 ? 0.01 : 0.5);
  const right = Array.from({ length: 100 }, (_, index) => index < 50 ? -0.01 : -0.5);
  const result = analyzeAudioBuffer(fakeBuffer([left, right], 1000), { measuredAt: 1, windowMs: 50 });
  assert.equal(result.source.channels, 2);
  assert.ok(result.measurements.rmsDbFS < 0);
  assert.ok(result.measurements.silenceWindowRatio >= 0 && result.measurements.silenceWindowRatio <= 1);
  assert.ok(result.measurements.dynamicRangeDb >= 0);
});

test('analysis rejects malformed buffers instead of fabricating measurements', () => {
  assert.throws(() => analyzeAudioBuffer(null), /AudioBuffer inválido/);
  assert.throws(() => analyzeAudioBuffer({ numberOfChannels: 1, sampleRate: 0, length: 1, getChannelData: () => new Float32Array(1) }), /Sample rate inválido/);
});
