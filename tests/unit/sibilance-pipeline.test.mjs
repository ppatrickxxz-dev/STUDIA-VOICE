import assert from 'node:assert/strict';
import test from 'node:test';
import { detectBreathAndSibilance } from '../../packages/audio/src/analyzers/breath-sibilance.mjs';
import { analyzeMusicalAudio } from '../../packages/audio/src/analyzers/pipeline.mjs';

const sampleRate = 16000;

function seededNoise(length, seed = 99) {
  const out = new Float32Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (1664525 * state + 1013904223) >>> 0;
    out[index] = (((state / 0xffffffff) * 2) - 1) * 0.07;
  }
  return out;
}

test('canonical detection and voice pipeline preserve adaptive spectral fields on sibilance events', () => {
  const samples = seededNoise(Math.floor(sampleRate * 0.45));
  const detected = detectBreathAndSibilance(samples, { sampleRate, frameSize: 512, hopSize: 256 });
  assert.ok(detected.sibilanceEvents.length >= 1);
  const direct = detected.sibilanceEvents[0];
  assert.ok(Number.isFinite(direct.frequencyHz));
  assert.ok(direct.frequencyHz >= 4800 && direct.frequencyHz <= sampleRate * 0.44 + 1);
  assert.ok(Number.isFinite(direct.spectralConfidence));
  assert.equal(direct.spectralSource, 'local-sibilance-spectrum-v1');

  const analyzed = analyzeMusicalAudio({
    samples,
    sampleRate,
    pitchOptions: { frameSize: 512, hopSize: 512 },
  });
  assert.ok(analyzed.voice.sibilanceEvents.length >= 1);
  const piped = analyzed.voice.sibilanceEvents[0];
  assert.ok(Number.isFinite(piped.frequencyHz));
  assert.ok(Number.isFinite(piped.spectralConfidence));
  assert.equal(piped.spectralSource, 'local-sibilance-spectrum-v1');
});
