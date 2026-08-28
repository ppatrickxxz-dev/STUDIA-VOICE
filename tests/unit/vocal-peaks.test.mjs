import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVocalPeaks } from '../../packages/audio/src/analyzers/vocal-peaks.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

const sampleRate = 16000;

function voiceWithPeaks({ seconds = 1 } = {}) {
  const length = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const time = i / sampleRate;
    let value = Math.sin(2 * Math.PI * 210 * time) * 0.035;
    for (const at of [0.38, 0.68]) {
      const local = time - at;
      if (local >= 0 && local < 0.035) value += Math.sin(2 * Math.PI * 440 * time) * 0.62 * Math.exp(-local * 32);
    }
    samples[i] = value;
  }
  return samples;
}

function steadyVoice({ seconds = 0.8 } = {}) {
  const length = Math.floor(seconds * sampleRate);
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i += 1) samples[i] = Math.sin(2 * Math.PI * 210 * i / sampleRate) * 0.07;
  return samples;
}

test('detects short high-level vocal transients as peak evidence', () => {
  const result = detectVocalPeaks(voiceWithPeaks(), { sampleRate, frameSize: 256, hopSize: 64 });
  assert.ok(result.peakEvents.length >= 2, `expected at least two peaks, got ${result.peakEvents.length}`);
  assert.ok(result.peakEvents.every((event) => event.confidence >= 0.66));
  assert.ok(result.peakEvents.every((event) => event.source === 'vocal-peak-transient-v1'));
});

test('steady vocal level does not become peak evidence merely because audio starts', () => {
  const result = detectVocalPeaks(steadyVoice(), { sampleRate, frameSize: 256, hopSize: 64 });
  assert.equal(result.peakEvents.length, 0);
  assert.equal(result.frames[0].transientRise, 1);
});

test('canonical pipeline preserves local peak events and peak count', () => {
  const samples = voiceWithPeaks();
  const analysis = analyzeMusicalAudio({
    samples,
    sampleRate,
    pitchOptions: { frameSize: 512, hopSize: 512 },
    peakDetectionOptions: { frameSize: 256, hopSize: 64 },
  });
  assert.ok(analysis.voice.peakEvents.length >= 2);
  assert.equal(analysis.voice.eventDetection.peakCount, analysis.voice.peakEvents.length);
  assert.equal(analysis.voice.peakEvents[0].source, 'vocal-peak-transient-v1');
});
