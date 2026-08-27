import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePitch, midiToNoteName } from '../../packages/audio/src/analyzers/pitch.mjs';
import { analyzeTempo } from '../../packages/audio/src/analyzers/tempo.mjs';
import { analyzeVoice, classifyBreathAction } from '../../packages/audio/src/analyzers/voice.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

function sine(frequency, sampleRate, seconds, amplitude = 0.8) {
  const length = Math.floor(sampleRate * seconds);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
  return data;
}

test('pitch analyzer detects A4 and emits note events', () => {
  const result = analyzePitch(sine(440, 48000, 0.5), 48000);
  const voiced = result.pitchContour.filter((point) => point.voiced);
  assert.ok(voiced.length > 0);
  const meanHz = voiced.reduce((sum, point) => sum + point.hz, 0) / voiced.length;
  assert.ok(Math.abs(meanHz - 440) < 8, `expected near 440Hz, got ${meanHz}`);
  assert.equal(midiToNoteName(69), 'A4');
  assert.ok(result.noteEvents.some((event) => event.note === 'A4'));
});

test('tempo analyzer derives roughly 120 BPM and beat grid', () => {
  const onsets = [0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0].map((time) => ({ time }));
  const result = analyzeTempo(onsets, { durationSeconds: 4 });
  assert.ok(Math.abs(result.bpm - 120) < 1);
  assert.ok(result.confidence > 0.9);
  assert.ok(result.beats.length >= 8);
  assert.equal(result.tempoMap.length, 1);
});

test('voice analysis summarizes range and gates breath actions by confidence', () => {
  const pitchContour = [
    { hz: 220, midi: 57, voiced: true, confidence: 0.9 },
    { hz: 233, midi: 58, voiced: true, confidence: 0.92 },
    { hz: 247, midi: 59, voiced: true, confidence: 0.88 },
  ];
  const result = analyzeVoice({ pitchContour, breathEvents: [{ time: 1.2, intensity: 0.8, confidence: 0.9 }] });
  assert.equal(result.rangeHz.length, 2);
  assert.ok(result.pitchConfidence > 0.85);
  assert.equal(classifyBreathAction({ intensity: 0.8, confidence: 0.9 }).mode, 'auto');
  assert.equal(classifyBreathAction({ intensity: 0.5, confidence: 0.6 }).mode, 'suggest');
  assert.equal(classifyBreathAction({ intensity: 0.9, confidence: 0.3 }).action, 'keep');
});

test('pipeline shares one analysis result across music and voice consumers', () => {
  const samples = sine(440, 48000, 0.5);
  const result = analyzeMusicalAudio({ samples, sampleRate: 48000, onsets: [{time:0},{time:0.5},{time:1.0},{time:1.5}], durationSeconds: 2 });
  assert.ok(result.music.noteEvents.length > 0);
  assert.ok(Math.abs(result.music.bpm - 120) < 1);
  assert.ok(result.voice.pitchContour.length > 0);
  assert.ok(result.confidence.pitch > 0);
});
