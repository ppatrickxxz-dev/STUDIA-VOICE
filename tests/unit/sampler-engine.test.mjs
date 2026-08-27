import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSamplerState,
  normalizeSamplerState,
  samplerPadDuration,
  selectSamplerPad,
  updateSamplerPad,
} from '../../packages/app/sampler-engine.mjs';

test('creates reusable pads from canonical onset slices without duplicating audio', () => {
  const state = createSamplerState({
    sourceAssetId: 'asset_voice_1',
    analysisSchemaVersion: 2,
    slices: [
      { id: 'slice_1', start: 0, end: 0.4 },
      { id: 'slice_2', start: 0.4, end: 0.9 },
    ],
  });

  assert.equal(state.schema, 'pablovoice_sampler_v1');
  assert.equal(state.pads.length, 2);
  assert.equal(state.pads[0].sourceAssetId, 'asset_voice_1');
  assert.equal(state.pads[1].sourceAssetId, 'asset_voice_1');
  assert.equal(state.pads[1].start, 0.4);
  assert.equal(samplerPadDuration(state.pads[1]), 0.5);
});

test('sampler is capped to a touch-friendly 16 pad bank by default', () => {
  const slices = Array.from({ length: 24 }, (_, index) => ({
    id: `slice_${index + 1}`,
    start: index * 0.1,
    end: index * 0.1 + 0.08,
  }));
  const state = createSamplerState({ sourceAssetId: 'asset_many', slices });
  assert.equal(state.pads.length, 16);
});

test('pad editing clamps unsafe values while preserving trim and source identity', () => {
  const state = createSamplerState({
    sourceAssetId: 'asset_1',
    slices: [{ id: 'slice_1', start: 0.1, end: 0.6 }],
  });
  const next = updateSamplerPad(state, 'pad_1', {
    start: 0.2,
    end: 0.4,
    gain: 9,
    fadeIn: 9,
    fadeOut: 9,
  });
  const pad = next.pads[0];
  assert.equal(pad.start, 0.2);
  assert.equal(pad.end, 0.4);
  assert.equal(pad.gain, 2);
  assert.ok(pad.fadeIn <= 0.1);
  assert.ok(pad.fadeOut <= 0.1);
  assert.equal(pad.sourceAssetId, 'asset_1');
});

test('selection and persisted state normalize safely', () => {
  const state = createSamplerState({
    sourceAssetId: 'asset_2',
    slices: [
      { id: 'slice_1', start: 0, end: 0.2 },
      { id: 'slice_2', start: 0.2, end: 0.5 },
    ],
  });
  const selected = selectSamplerPad(state, 'pad_2');
  const restored = normalizeSamplerState(structuredClone(selected));
  assert.equal(restored.selectedPadId, 'pad_2');
  assert.equal(restored.pads.length, 2);
  assert.equal(restored.sourceAssetId, 'asset_2');
});
