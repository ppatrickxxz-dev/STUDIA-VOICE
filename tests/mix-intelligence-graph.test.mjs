import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProjectMixState, planMixIntent } from '../packages/audio/src/mix/mix-intelligence-graph.mjs';

const analysis = (lufs, spectral) => ({ signal: { loudnessLufs: { value: lufs }, spectralEnvelope: spectral }, confidence: { voice: 0.92 } });

test('buildProjectMixState detects inter-track masking evidence', () => {
  const state = buildProjectMixState({ tracks: [
    { trackId: 'vocal', role: 'lead-vocal', analysis: analysis(-14, [1, 0.9, 0.7, 0.2]) },
    { trackId: 'beat', role: 'instrumental', analysis: analysis(-12, [0.95, 0.85, 0.65, 0.1]) },
  ]});
  assert.equal(state.relations.length, 1);
  assert.ok(state.relations[0].spectralOverlap > 0.9);
  assert.ok(state.relations[0].maskingRisk > 0.45);
});

test('voice-forward creates non-destructive project-aware actions', () => {
  const state = buildProjectMixState({ tracks: [
    { trackId: 'vocal', role: 'lead-vocal', analysis: analysis(-15, [1, 1, 0.8]) },
    { trackId: 'music', role: 'instrumental', analysis: analysis(-12, [1, 0.95, 0.75]) },
  ]});
  const plan = planMixIntent(state, 'voice-forward');
  assert.equal(plan.targetTrackId, 'vocal');
  assert.ok(plan.actions.some((a) => a.type === 'dynamic-space' && a.sidechainFrom === 'vocal'));
  assert.ok(plan.actions.every((a) => a.destructive === false));
  assert.notEqual(plan.decision, 'manual');
});
