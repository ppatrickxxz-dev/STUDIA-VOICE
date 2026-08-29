import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFormants } from '../../packages/audio/src/analyzers/formants.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

const SAMPLE_RATE = 16000;

function syntheticVowel(seconds = 1.2) {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  for (let index = 0; index < samples.length; index += 1) {
    const time = index / SAMPLE_RATE;
    const envelope = Math.min(1, index / 320, (samples.length - index) / 320);
    samples[index] = envelope * (
      0.08 * Math.sin(2 * Math.PI * 140 * time)
      + 0.34 * Math.sin(2 * Math.PI * 500 * time)
      + 0.27 * Math.sin(2 * Math.PI * 1500 * time)
      + 0.2 * Math.sin(2 * Math.PI * 2500 * time)
    );
  }
  return samples;
}

function near(actual, expected, tolerance) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual}Hz was not within ${tolerance}Hz of ${expected}Hz`);
}

test('local formant analyzer extracts a stable three-band vocal spectral profile', () => {
  const result = analyzeFormants(syntheticVowel(), { sampleRate: SAMPLE_RATE, maxFrames: 10 });
  assert.equal(result.source, 'local-spectral-formant-profile-v1');
  assert.equal(result.formantsHz.length, 3);
  assert.equal(result.stable, true);
  assert.ok(result.confidence >= 0.58);
  near(result.formantsHz[0], 500, 170);
  near(result.formantsHz[1], 1500, 260);
  near(result.formantsHz[2], 2500, 320);
  assert.ok(result.frameCount >= 3);
});

test('local formant analyzer is deterministic for the same PCM and options', () => {
  const samples = syntheticVowel();
  const first = analyzeFormants(samples, { sampleRate: SAMPLE_RATE, maxFrames: 10 });
  const second = analyzeFormants(samples, { sampleRate: SAMPLE_RATE, maxFrames: 10 });
  assert.deepEqual(second, first);
});

test('local formant analyzer fails closed on silence and invalid audio', () => {
  const silent = analyzeFormants(new Float32Array(SAMPLE_RATE), { sampleRate: SAMPLE_RATE });
  assert.deepEqual(silent.formantsHz, []);
  assert.equal(silent.stable, false);
  assert.equal(silent.confidence, 0);

  const invalid = analyzeFormants(null, { sampleRate: SAMPLE_RATE });
  assert.deepEqual(invalid.formantsHz, []);
  assert.equal(invalid.stable, false);
});

test('audio pipeline preserves supplied formants as authoritative evidence', () => {
  const samples = syntheticVowel(0.5);
  const supplied = [515, 1475, 2470];
  const result = analyzeMusicalAudio({
    samples,
    sampleRate: SAMPLE_RATE,
    formants: supplied,
    breathEvents: [],
    sibilanceEvents: [],
    plosiveEvents: [],
    peakEvents: [],
    clickEvents: [],
    noiseEvents: [],
  });
  assert.deepEqual(result.voice.formants, supplied);
  assert.equal(result.voice.formantEvidence.source, 'provided');
  assert.equal(result.voice.formantEvidence.confidence, 1);
  assert.equal(result.voice.formantEvidence.stable, true);
});

test('audio pipeline can derive local formant evidence when none is supplied', () => {
  const samples = syntheticVowel();
  const result = analyzeMusicalAudio({
    samples,
    sampleRate: SAMPLE_RATE,
    breathEvents: [],
    sibilanceEvents: [],
    plosiveEvents: [],
    peakEvents: [],
    clickEvents: [],
    noiseEvents: [],
    formantOptions: { maxFrames: 8 },
  });
  assert.equal(result.voice.formantEvidence.source, 'local-spectral-formant-profile-v1');
  assert.equal(result.voice.formantEvidence.formantsHz.length, 3);
  if (result.voice.formantEvidence.stable) {
    assert.deepEqual(result.voice.formants, result.voice.formantEvidence.formantsHz);
  } else {
    assert.deepEqual(result.voice.formants, []);
  }
});

test('audio pipeline never promotes silent local formant evidence into the voice profile', () => {
  const result = analyzeMusicalAudio({
    samples: new Float32Array(SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    breathEvents: [],
    sibilanceEvents: [],
    plosiveEvents: [],
    peakEvents: [],
    clickEvents: [],
    noiseEvents: [],
  });
  assert.equal(result.voice.formantEvidence.source, 'local-spectral-formant-profile-v1');
  assert.equal(result.voice.formantEvidence.stable, false);
  assert.equal(result.voice.formantEvidence.confidence, 0);
  assert.deepEqual(result.voice.formantEvidence.formantsHz, []);
  assert.deepEqual(result.voice.formants, []);
});
