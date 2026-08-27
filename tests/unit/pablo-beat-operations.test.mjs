import test from 'node:test';
import assert from 'node:assert/strict';

import { createProject } from '../../packages/core/src/project.mjs';
import { applyPabloBeatOperation } from '../../packages/app/pablo-beat-operations.mjs';

function sampler({ grooveReady = true } = {}) {
  return {
    schema: 'pablovoice_sampler_v2',
    sourceAssetId: 'asset_beat',
    grooveTemplate: {
      ready: grooveReady,
      bpm: 120,
      confidence: grooveReady ? 0.82 : 0.1,
      stepsPerBar: 16,
      offsetsBeats: Array.from({ length: 16 }, (_, index) => index % 2 ? 0.04 : 0),
      accents: Array.from({ length: 16 }, (_, index) => index % 4 === 0 ? 1 : 0.65),
    },
    pads: [
      { id: 'pad_kick', sourceAssetId: 'asset_beat', label: 'Kick', start: 0, end: 0.18, category: 'kick', categoryConfidence: 0.92, gain: 1, fadeIn: 0, fadeOut: 0, playbackRate: 1 },
      { id: 'pad_snare', sourceAssetId: 'asset_beat', label: 'Snare', start: 0.2, end: 0.42, category: 'snare', categoryConfidence: 0.86, gain: 1, fadeIn: 0, fadeOut: 0, playbackRate: 1 },
      { id: 'pad_hat', sourceAssetId: 'asset_beat', label: 'Hat', start: 0.44, end: 0.54, category: 'closed_hat', categoryConfidence: 0.78, gain: 1, fadeIn: 0, fadeOut: 0, playbackRate: 1 },
    ],
  };
}

function projectWithSampler(options) {
  const project = createProject('Beat command test', 1000);
  project.sampler = sampler(options);
  return project;
}

test('humanize creates a reversible Beat Lab revision with bounded amount', async () => {
  const project = projectWithSampler();
  const result = await applyPabloBeatOperation(project, { action: 'humanize', args: { amount: 0.65 } });
  assert.equal(result.ok, true);
  assert.equal(result.mutated, true);
  assert.equal(result.project.beatLab.humanize, 0.65);
  assert.equal(result.project.revisions.at(-1).label, 'Beat humanizado pelo Pablo');
  assert.equal(project.beatLab, undefined);
});

test('reference groove only applies when the sampler has sufficient evidence', async () => {
  const allowed = await applyPabloBeatOperation(projectWithSampler(), { action: 'apply_groove', args: { amount: 0.85 } });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.project.beatLab.grooveAmount, 0.85);

  const blocked = await applyPabloBeatOperation(projectWithSampler({ grooveReady: false }), { action: 'apply_groove', args: { amount: 0.65 } });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.mutated, false);
  assert.equal(blocked.reason, 'groove_evidence_unavailable');
});

test('fill uses an existing percussive lane and never fabricates a missing sound', async () => {
  const result = await applyPabloBeatOperation(projectWithSampler(), { action: 'fill', args: { intensity: 0.65 } });
  assert.equal(result.ok, true);
  assert.equal(result.project.beatLab.lastOperation.ok, true);
  assert.equal(result.project.beatLab.lastOperation.category, 'snare');
  assert.ok(result.data.activeSteps > 0);
});

test('section placement and genre patterns stay blocked until their own gates exist', async () => {
  const project = projectWithSampler();
  const section = await applyPabloBeatOperation(project, { action: 'fill_before_section', args: { section: 'chorus' } });
  assert.equal(section.ok, false);
  assert.equal(section.reason, 'section_mapping_required');
  assert.equal(section.mutated, false);

  const genre = await applyPabloBeatOperation(project, { action: 'genre_pattern', args: { genre: 'funk' } });
  assert.equal(genre.ok, false);
  assert.equal(genre.reason, 'genre_pattern_preview_only');
  assert.equal(genre.mutated, false);
});

test('operations require real sampler pads before touching Beat Lab state', async () => {
  const project = createProject('No pads', 1000);
  const result = await applyPabloBeatOperation(project, { action: 'humanize', args: { amount: 0.4 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'sampler_required');
  assert.equal(result.mutated, false);
});
