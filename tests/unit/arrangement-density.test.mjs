import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARRANGEMENT_DENSITY_POLICY_V1,
  applyArrangementDensityPlan,
  classifyArrangementReadiness,
} from '../../packages/audio/src/arrangement/density-plan.mjs';

function project() {
  return {
    id: 'project-1',
    lyrics: 'não muda',
    tracks: [
      {
        id: 'lead', assetId: 'asset-lead', duration: 184.96, sampleRate: 48000, channels: 1,
        offset: 0, trimStart: 0, trimEnd: 184.96, gain: 1, pan: 0, muted: false, solo: false,
        effects: { clean: true }, regionAutomation: [{ id: 'lead-existing', startSeconds: 1, endSeconds: 2, gainDb: -1, source: 'manual' }],
      },
      {
        id: 'instrumental', assetId: 'asset-inst', duration: 184.96, sampleRate: 48000, channels: 2,
        offset: 0, trimStart: 0, trimEnd: 184.96, gain: 1, pan: 0, muted: false, solo: false,
        effects: {}, regionAutomation: [{ id: 'manual-1', startSeconds: 2, endSeconds: 3, gainDb: -2, source: 'manual' }],
      },
    ],
  };
}

const REGIONS = [
  { label: 'opening_space', startSeconds: 0, endSeconds: 12, gainDb: -8 },
  { label: 'first_contrast', startSeconds: 18, endSeconds: 34, gainDb: -3 },
];

test('B08 changes only target instrumental region automation', () => {
  const before = project();
  const result = applyArrangementDensityPlan(before, {
    leadTrackId: 'lead',
    targetTrackIds: ['instrumental'],
    regions: REGIONS,
  });
  const after = result.project;
  assert.deepEqual(before.tracks[0], after.tracks[0]);
  assert.equal(after.lyrics, before.lyrics);
  assert.deepEqual(after.tracks.map((track) => track.assetId), before.tracks.map((track) => track.assetId));
  assert.equal(after.tracks[1].regionAutomation[0].source, 'manual');
  assert.equal(after.tracks[1].regionAutomation.filter((event) => event.source === ARRANGEMENT_DENSITY_POLICY_V1.source).length, 2);
});

test('B08 refuses to target the lead vocal', () => {
  assert.throws(() => applyArrangementDensityPlan(project(), {
    leadTrackId: 'lead', targetTrackIds: ['lead'], regions: REGIONS,
  }), /lead vocal/i);
});

test('B08 refuses positive boosts and over-attenuation', () => {
  assert.throws(() => applyArrangementDensityPlan(project(), {
    leadTrackId: 'lead', targetTrackIds: ['instrumental'], regions: [{ startSeconds: 1, endSeconds: 2, gainDb: 1 }],
  }), /attenuation-only/i);
  assert.throws(() => applyArrangementDensityPlan(project(), {
    leadTrackId: 'lead', targetTrackIds: ['instrumental'], regions: [{ startSeconds: 1, endSeconds: 2, gainDb: -20 }],
  }), /attenuation-only/i);
});

test('B08 readiness is not a score before retained benchmark output', () => {
  assert.deepEqual(classifyArrangementReadiness({
    plannerPresent: true,
    runtimeRegionAutomationPresent: true,
    leadPreservationGuardPresent: true,
  }), {
    implementationReady: true,
    retainedBenchmarkOutput: false,
    scorable: false,
    state: 'implementation_ready_unexecuted',
  });
});
