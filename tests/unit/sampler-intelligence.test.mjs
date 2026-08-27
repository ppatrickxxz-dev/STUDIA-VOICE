import test from 'node:test';
import assert from 'node:assert/strict';

import { createSlicesFromAnalysis } from '../../packages/audio/src/sampler/audio-to-instrument.mjs';
import { extractGrooveTemplate } from '../../packages/audio/src/sampler/groove-template.mjs';
import { classifyPadAcoustics } from '../../packages/app/pad-acoustics.mjs';
import { createSamplerState, normalizeSamplerState } from '../../packages/app/sampler-engine.mjs';

test('canonical onset timeSeconds becomes real sampler slice boundaries', () => {
  const slices = createSlicesFromAnalysis({
    source: { durationSeconds: 1 },
    signal: { onsets: [
      { timeSeconds: 0.2, confidence: 0.8, strength: 0.5 },
      { timeSeconds: 0.5, confidence: 0.9, strength: 0.7 },
    ] },
  });
  assert.deepEqual(slices.map((slice) => [slice.start, slice.end]), [
    [0, 0.2],
    [0.2, 0.5],
    [0.5, 1],
  ]);
  assert.equal(slices[1].onsetConfidence, 0.8);
});

test('groove template preserves repeated sixteenth timing offsets when tempo evidence is reliable', () => {
  const groove = extractGrooveTemplate({
    music: { bpm: 120, bpmConfidence: 0.9 },
    signal: { onsets: [0, 0.15, 0.25, 0.4, 0.5, 0.65, 0.75, 0.9].map((timeSeconds) => ({ timeSeconds, confidence: 0.9, strength: 1 })) },
  });
  assert.equal(groove.ready, true);
  assert.equal(groove.stepsPerBar, 16);
  assert.ok(groove.confidence >= 0.35);
  assert.ok(Math.abs(groove.offsetsBeats[1] - 0.05) < 1e-6);
});

test('pad classifier distinguishes strong low transient from short high-frequency transient', () => {
  const kick = classifyPadAcoustics({
    duration: 0.24, rms: 0.2, peak: 0.9, zeroCrossRate: 0.03,
    transientness: 0.9, decay: 0.8, lowRatio: 0.78, midRatio: 0.15, highRatio: 0.07, centroidHz: 190,
  });
  const hat = classifyPadAcoustics({
    duration: 0.09, rms: 0.13, peak: 0.65, zeroCrossRate: 0.28,
    transientness: 0.8, decay: 0.7, lowRatio: 0.05, midRatio: 0.12, highRatio: 0.83, centroidHz: 6900,
  });
  assert.equal(kick.category, 'kick');
  assert.equal(hat.category, 'closed_hat');
  assert.ok(kick.confidence > 0.45);
  assert.ok(hat.confidence > 0.45);
});

test('sampler v2 persists groove and acoustic classification metadata without duplicating audio', () => {
  const state = createSamplerState({
    sourceAssetId: 'asset_1',
    slices: [{ id: 'slice_1', start: 0, end: 0.2, onsetConfidence: 0.8, onsetStrength: 0.5 }],
    groove: { ready: true, bpm: 100, confidence: 0.7, stepsPerBar: 16, offsetsBeats: [0, 0.02], accents: [1, 0.5] },
  });
  state.pads[0].category = 'kick';
  state.pads[0].categoryConfidence = 0.82;
  state.pads[0].categorySource = 'local_acoustic_heuristic_v1';
  const clean = normalizeSamplerState(state);
  assert.equal(clean.schema, 'pablovoice_sampler_v2');
  assert.equal(clean.grooveTemplate.ready, true);
  assert.equal(clean.grooveTemplate.bpm, 100);
  assert.equal(clean.pads[0].sourceAssetId, 'asset_1');
  assert.equal(clean.pads[0].category, 'kick');
  assert.equal(clean.pads[0].categoryConfidence, 0.82);
});
