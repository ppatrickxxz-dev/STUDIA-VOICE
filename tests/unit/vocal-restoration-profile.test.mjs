import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVocalRestoration } from '../../packages/audio/src/analyzers/vocal-restoration.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

const SAMPLE_RATE = 16000;

function fixture({ seconds = 3, noiseAmplitude = 0.008, reflectionAmount = 0.18, reflectionDelayMs = 36 } = {}) {
  const length = Math.floor(seconds * SAMPLE_RATE);
  const dry = new Float32Array(length);
  const voiceRanges = [[0.18, 0.58], [0.82, 1.22], [1.48, 1.88], [2.12, 2.52]];
  let random = 0x12345678;
  for (let index = 0; index < length; index += 1) {
    const time = index / SAMPLE_RATE;
    random = (1664525 * random + 1013904223) >>> 0;
    const noise = (((random / 0xffffffff) * 2) - 1) * noiseAmplitude;
    let voice = 0;
    for (const [start, end] of voiceRanges) {
      if (time < start || time >= end) continue;
      const phase = (time - start) / (end - start);
      const envelope = Math.min(1, phase / 0.035, (1 - phase) / 0.05);
      voice += envelope * (0.12 * Math.sin(2 * Math.PI * 220 * time) + 0.045 * Math.sin(2 * Math.PI * 660 * time));
    }
    dry[index] = voice + noise;
  }
  const delay = Math.round(reflectionDelayMs * SAMPLE_RATE / 1000);
  const wet = new Float32Array(dry);
  for (let index = delay; index < wet.length; index += 1) wet[index] += reflectionAmount * dry[index - delay];
  const pitchContour = [];
  for (let time = 0; time < seconds; time += 0.012) {
    const voiced = voiceRanges.some(([start, end]) => time >= start && time < end);
    pitchContour.push({ time, voiced, confidence: voiced ? 0.94 : 0, hz: voiced ? 220 : null, midi: voiced ? 57 : null });
  }
  return { dry, wet, pitchContour };
}

test('measures section-ready noise and early reflection evidence with explicit timbre guard', () => {
  const { wet, pitchContour } = fixture();
  const profile = analyzeVocalRestoration(wet, { sampleRate: SAMPLE_RATE, pitchContour });
  assert.equal(profile.source, 'local-vocal-restoration-profile-v1');
  assert.equal(profile.timbreGuard.pitchPreserving, true);
  assert.equal(profile.timbreGuard.formantPreserving, true);
  assert.ok(profile.noiseWindowCount >= 1);
  assert.ok(profile.reverbWindowCount >= 1);
  const noise = profile.windows.find((window) => window.noise.actionable)?.noise;
  assert.ok(noise.noiseFloorDb >= -58 && noise.noiseFloorDb <= -30);
  assert.ok(noise.voicedMarginDb >= 10);
  assert.ok(noise.reductionDb <= 5.5);
  const reverb = profile.windows.find((window) => window.reverb.actionable)?.reverb;
  assert.ok(reverb.reflectionDelayMs >= 18 && reverb.reflectionDelayMs <= 90);
  assert.ok(reverb.amount <= 0.2);
  assert.ok(reverb.confidence >= 0.72);
});

test('fails closed for inaudible floor and for dry vocal without a prominent reflection', () => {
  const quiet = fixture({ noiseAmplitude: 0.00008, reflectionAmount: 0 });
  const quietProfile = analyzeVocalRestoration(quiet.dry, { sampleRate: SAMPLE_RATE, pitchContour: quiet.pitchContour });
  assert.equal(quietProfile.noiseWindowCount, 0);
  assert.equal(quietProfile.reverbWindowCount, 0);

  const dry = fixture({ reflectionAmount: 0 });
  const dryProfile = analyzeVocalRestoration(dry.dry, { sampleRate: SAMPLE_RATE, pitchContour: dry.pitchContour });
  assert.equal(dryProfile.reverbWindowCount, 0);
});

test('canonical musical pipeline exposes restoration from the same PCM analysis', () => {
  const { wet } = fixture({ seconds: 1.5 });
  const result = analyzeMusicalAudio({ samples: wet, sampleRate: SAMPLE_RATE, pitchOptions: { frameSize: 1024, hopSize: 512, rmsGate: 0.008 } });
  assert.equal(result.voice.restoration.source, 'local-vocal-restoration-profile-v1');
  assert.ok(Array.isArray(result.voice.restoration.windows));
  assert.equal(result.voice.eventDetection.noiseWindowCount, result.voice.restoration.noiseWindowCount);
  assert.equal(result.voice.eventDetection.reverbWindowCount, result.voice.restoration.reverbWindowCount);
});
