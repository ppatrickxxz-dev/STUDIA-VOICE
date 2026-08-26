import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, normalizationFactor, wavHeader } from '../../packages/audio/src/presets.mjs';

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

