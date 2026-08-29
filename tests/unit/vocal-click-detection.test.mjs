import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVocalClicks } from '../../packages/audio/src/analyzers/vocal-clicks.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

const sampleRate = 16000;

function voiceWithClick({ seconds = 1, clickAt = 0.42 } = {}) {
  const length = Math.floor(seconds * sampleRate);
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    out[index] = Math.sin(2 * Math.PI * 220 * time) * 0.015;
  }
  const start = Math.floor(clickAt * sampleRate);
  const impulse = [0.56, -0.44, 0.34, -0.25, 0.17, -0.1, 0.05];
  for (let index = 0; index < impulse.length && start + index < out.length; index += 1) out[start + index] += impulse[index];
  return out;
}

test('short broadband impulse becomes vocal click evidence', () => {
  const result = detectVocalClicks(voiceWithClick(), { sampleRate, frameSize: 64, hopSize: 16 });
  assert.ok(result.clickEvents.length >= 1, 'expected a click event');
  const event = result.clickEvents.find((item) => item.start < 0.47 && item.end > 0.38);
  assert.ok(event, 'expected click near synthetic impulse');
  assert.ok(event.confidence >= 0.68);
  assert.ok(event.end - event.start <= 0.05);
  assert.ok(event.differenceRatio >= 0.45);
  assert.ok(event.lowFrequencyRatio <= 0.58);
  assert.equal(event.source, 'vocal-click-impulse-v1');
});

test('steady voiced tone does not become a click because audio starts', () => {
  const samples = voiceWithClick({ clickAt: 2 });
  const result = detectVocalClicks(samples, { sampleRate, frameSize: 64, hopSize: 16 });
  assert.equal(result.clickEvents.length, 0);
  assert.equal(result.frames[0].transientRise, 1);
});

test('click candidate overlapping measured plosive is rejected', () => {
  const samples = voiceWithClick();
  const result = detectVocalClicks(samples, {
    sampleRate,
    frameSize: 64,
    hopSize: 16,
    plosiveEvents: [{ start: 0.39, end: 0.47, confidence: 0.9, frequencyHz: 120 }],
  });
  assert.equal(result.clickEvents.length, 0);
  assert.ok(result.rejectedByPlosiveOverlap >= 1);
});

test('sustained peak shape is rejected while short or high-crest framed peak evidence does not blanket-veto a click', () => {
  const samples = voiceWithClick();
  const rejected = detectVocalClicks(samples, {
    sampleRate,
    frameSize: 64,
    hopSize: 16,
    peakEvents: [{ start: 0.39, end: 0.49, confidence: 0.9, intensity: 1, peak: 0.32, rms: 0.16 }],
  });
  assert.equal(rejected.clickEvents.length, 0);
  assert.ok(rejected.rejectedBySustainedPeakOverlap >= 1);

  const shortRetained = detectVocalClicks(samples, {
    sampleRate,
    frameSize: 64,
    hopSize: 16,
    peakEvents: [{ start: 0.415, end: 0.43, confidence: 0.9, intensity: 1, peak: 0.56, rms: 0.06 }],
  });
  assert.ok(shortRetained.clickEvents.length >= 1);

  const framedImpulseRetained = detectVocalClicks(samples, {
    sampleRate,
    frameSize: 64,
    hopSize: 16,
    peakEvents: [{ start: 0.39, end: 0.49, confidence: 0.9, intensity: 1, peak: 0.56, rms: 0.05 }],
  });
  assert.ok(framedImpulseRetained.clickEvents.length >= 1);
});

test('canonical pipeline exposes clickEvents and explicit five-family evidence remains provided', () => {
  const samples = voiceWithClick();
  const detected = analyzeMusicalAudio({
    samples,
    sampleRate,
    pitchOptions: { frameSize: 512, hopSize: 512 },
    clickDetectionOptions: { frameSize: 64, hopSize: 16 },
  });
  assert.ok(Array.isArray(detected.voice.clickEvents));
  assert.ok(detected.voice.clickEvents.length >= 1);
  assert.equal(detected.voice.eventDetection.clickCount, detected.voice.clickEvents.length);
  assert.equal(detected.voice.eventDetection.source, 'local-heuristic-v1');

  const providedClick = [{ start: 0.2, end: 0.21, intensity: 0.7, confidence: 0.9, differenceRatio: 1.2, lowFrequencyRatio: 0.2, source: 'provided-click' }];
  const provided = analyzeMusicalAudio({
    samples,
    sampleRate,
    breathEvents: [],
    sibilanceEvents: [],
    plosiveEvents: [],
    peakEvents: [],
    clickEvents: providedClick,
    pitchOptions: { frameSize: 512, hopSize: 512 },
  });
  assert.equal(provided.voice.eventDetection.source, 'provided');
  assert.equal(provided.voice.clickEvents.length, 1);
  assert.equal(provided.voice.clickEvents[0].source, 'provided-click');
  assert.equal(provided.voice.clickEvents[0].differenceRatio, 1.2);
});
