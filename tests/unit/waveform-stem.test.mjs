import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWaveform } from '../../packages/audio/src/waveform-analyzer.mjs';
import { StemEngineRegistry, defaultStemRegistry, isPromotable, validateStemResult } from '../../packages/audio/src/stem-engine.mjs';

function fakeBuffer(samples, sampleRate = 1000) {
  const data = Float32Array.from(samples);
  return {
    numberOfChannels: 1,
    sampleRate,
    length: data.length,
    getChannelData: () => data,
  };
}

test('waveform analyzer measures only deterministic PCM facts and declares missing MIR fields', () => {
  const result = analyzeWaveform(fakeBuffer([0, 0.5, -1, 1, 0, 0]), { frameMs: 2, silenceDb: -40 });
  assert.equal(result.analyzer.id, 'pablovoice.waveform.v1');
  assert.equal(result.measured.absolutePeak, 1);
  assert.equal(result.measured.clippedSamples, 2);
  assert.ok(result.measured.rms > 0);
  assert.ok(result.notMeasured.includes('bpm'));
  assert.ok(result.notMeasured.includes('pitchContour'));
});

test('default stem providers remain hidden because no real validated provider is wired', () => {
  const registry = defaultStemRegistry();
  assert.equal(registry.select({ mode: '2stem' }), null);
  assert.equal(registry.list({ includeUnavailable: false }).length, 0);
  assert.equal(registry.capabilitySnapshot().every((provider) => provider.promotable === false), true);
});

test('StemEngine promotes only an available validated provider with a real implementation', () => {
  const provider = {
    id: 'fixture',
    family: 'test',
    available: true,
    validated: true,
    outputs: { '2stem': true },
    async separate() { return { vocals: new Uint8Array([1]), instrumental: new Uint8Array([2]) }; },
  };
  const registry = new StemEngineRegistry().register(provider);
  assert.equal(isPromotable(provider), true);
  assert.equal(registry.select({ mode: '2stem' }).id, 'fixture');
  assert.equal(validateStemResult({ vocals: {}, instrumental: {} }, '2stem'), true);
});

test('StemEngine rejects fake availability without separate implementation', () => {
  const registry = new StemEngineRegistry();
  assert.throws(() => registry.register({
    id: 'fake', family: 'test', available: true, validated: true, outputs: { '2stem': true }, separate: null,
  }), /real separate/);
});
