import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeWav, normalizationFactor, wavHeader } from '../../packages/audio/src/presets.mjs';
import { breathPlanToRegionAutomation, replaceBreathAutomation } from '../../packages/audio/src/voice/breath-intelligence.mjs';
import { regionGainEnvelope } from '../../packages/app/audio-engine.mjs';

function fakeBuffer(channels = [[0, .5, -1, 1]], sampleRate = 48000) {
  const data = channels.map((values) => Float32Array.from(values));
  return { numberOfChannels: data.length, sampleRate, length: data[0].length, getChannelData: (index) => data[index] };
}

test('WAV encoder creates a valid PCM16 header and exact payload size', () => {
  const wav = encodeWav(fakeBuffer());
  const header = wavHeader(wav);
  assert.deepEqual(header, { riff: 'RIFF', wave: 'WAVE', format: 1, channels: 1, sampleRate: 48000, bitsPerSample: 16, dataBytes: 8 });
  assert.equal(wav.byteLength, 52);
});

test('normalization is bounded to protect extreme gain changes', () => {
  assert.equal(normalizationFactor(fakeBuffer([[0, .5]]), 1), 2);
  assert.equal(normalizationFactor(fakeBuffer([[0, .001]]), 1), 2);
  assert.equal(normalizationFactor(fakeBuffer([[0, 1]]), .5), .5);
});

test('regional gain envelope lowers only the requested interval and returns to unity', () => {
  const points = regionGainEnvelope([{ startSeconds: 1, endSeconds: 1.4, gainDb: -6, enabled: true }], 0, 3);
  assert.equal(points.length, 4);
  assert.ok(points[0].time < 1);
  assert.ok(Math.abs(points[1].value - 0.501187) < 0.00001);
  assert.equal(points.at(-1).time, 1.4);
  assert.equal(points.at(-1).value, 1);
});

test('regional gain envelope skips disabled and out-of-window events', () => {
  assert.deepEqual(regionGainEnvelope([{ startSeconds: 1, endSeconds: 2, gainDb: -6, enabled: false }], 0, 3), []);
  assert.deepEqual(regionGainEnvelope([{ startSeconds: 1, endSeconds: 2, gainDb: -6 }], 2.1, 3), []);
});

test('only automatic breath decisions become audible regional automation', () => {
  const regions = breathPlanToRegionAutomation([
    { id: 'auto', startSeconds: 1, endSeconds: 1.3, reductionDb: -6, confidence: 0.91, decision: 'auto', automatic: true },
    { id: 'suggest', startSeconds: 2, endSeconds: 2.2, reductionDb: -6, confidence: 0.67, decision: 'suggest', automatic: false },
  ]);
  assert.deepEqual(regions, [{
    id: 'auto', kind: 'breath-gain', startSeconds: 1, endSeconds: 1.3, gainDb: -6, confidence: 0.91,
    source: 'pablo-breath-intelligence-v1', enabled: true,
  }]);
});

test('re-running Pablo breath automation replaces only Pablo-owned regions', () => {
  const existing = [
    { id: 'manual', source: 'manual', startSeconds: 0.2, endSeconds: 0.3, gainDb: -2, enabled: true },
    { id: 'old', source: 'pablo-breath-intelligence-v1', startSeconds: 1, endSeconds: 1.2, gainDb: -6, enabled: true },
  ];
  const next = replaceBreathAutomation(existing, [
    { id: 'new', startSeconds: 2, endSeconds: 2.2, reductionDb: -6, confidence: 0.95, decision: 'auto', automatic: true },
  ]);
  assert.equal(next.some((event) => event.id === 'manual'), true);
  assert.equal(next.some((event) => event.id === 'old'), false);
  assert.equal(next.some((event) => event.id === 'new'), true);
});

test('audio engine source exposes aligned per-track rendering for stem export', async () => {
  const source = await readFile(new URL('../../packages/app/audio-engine.mjs', import.meta.url), 'utf8');
  assert.match(source, /async renderTrack\(project,\s*trackId,\s*presetName = 'demo'\)/);
  assert.match(source, /new OfflineAudioContext\(2,\s*frames,\s*preset\.sampleRate\)/);
  assert.match(source, /ultrapassa 0 dBFS/);
});
