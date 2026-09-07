import test from 'node:test';
import assert from 'node:assert/strict';
import { createProject } from '../../packages/core/src/project.mjs';
import { createSamplerState } from '../../packages/app/sampler-engine.mjs';
import { createBeatLabState } from '../../packages/app/beat-lab-engine.mjs';
import {
  buildMusicalPlanReview,
  describeMusicalExecutionPlan,
  materializeMusicalPlanReview,
  validateMusicalPlanReview,
} from '../../packages/app/pablo-musical-plan-review.mjs';

function bassProject() {
  const project = createProject('Groove test', 1000);
  project.instrumentLab = {
    version: '2.0-local',
    preset: 'bass',
    bpm: 105,
    notes: [
      { midi: 36, velocity: 96, start_beat: 0, duration_beats: 0.5 },
      { midi: 36, velocity: 96, start_beat: 1, duration_beats: 0.5 },
      { midi: 39, velocity: 98, start_beat: 2, duration_beats: 0.5 },
      { midi: 41, velocity: 100, start_beat: 3, duration_beats: 0.5 },
    ],
  };
  return project;
}

test('musical plan review compiles and materializes a reversible bass reshape without pitch drift', async () => {
  const project = bassProject();
  const originalPitches = project.instrumentLab.notes.map((note) => note.midi);
  const review = await buildMusicalPlanReview('deixa esse baixo menos quadrado e mais vivo', project);

  assert.equal(review.supported, true);
  assert.equal(review.executionPlan.ok, true);
  assert.equal(review.executionPlan.executor, 'instrument_lab');
  assert.match(describeMusicalExecutionPlan(review.executionPlan), /pitch e quantidade de notas ficam preservados/i);
  assert.equal(validateMusicalPlanReview(review, project).ok, true);

  const result = await materializeMusicalPlanReview(review, project);
  assert.equal(result.ok, true);
  assert.equal(result.mutated, true);
  assert.deepEqual(result.project.instrumentLab.notes.map((note) => note.midi), originalPitches);
  assert.equal(result.project.instrumentLab.notes.length, project.instrumentLab.notes.length);
  assert.equal(result.invariants.reversible, true);
  assert.equal(result.invariants.baselineRevisionCaptured, true);
  assert.equal(project.revisions.length, 0, 'materialization must not mutate the source project object');
});

test('musical plan review fails closed when relevant instrument state drifts', async () => {
  const project = bassProject();
  const review = await buildMusicalPlanReview('deixa esse baixo menos quadrado', project);
  const changed = structuredClone(project);
  changed.instrumentLab.notes[0].velocity = 110;

  const validation = validateMusicalPlanReview(review, changed);
  assert.equal(validation.ok, false);
  assert.equal(validation.reason, 'musical_state_drift');

  const result = await materializeMusicalPlanReview(review, changed);
  assert.equal(result.ok, false);
  assert.equal(result.mutated, false);
  assert.equal(result.reason, 'musical_state_drift');
});

test('beat review applies only the deterministic local humanization and reports unhandled syncopation', async () => {
  const project = createProject('Beat test', 2000);
  project.sampler = createSamplerState({
    sourceAssetId: 'asset_drums',
    slices: [
      { id: 'kick', start: 0, end: 0.12 },
      { id: 'snare', start: 0.2, end: 0.32 },
    ],
  });
  project.sampler.pads[0].category = 'kick';
  project.sampler.pads[0].categoryConfidence = 0.95;
  project.sampler.pads[1].category = 'snare';
  project.sampler.pads[1].categoryConfidence = 0.92;
  project.beatLab = createBeatLabState(project.sampler, { bpm: 105 });

  const review = await buildMusicalPlanReview('deixa essa bateria menos reta e mais humana', project);
  assert.equal(review.supported, true);
  assert.equal(review.executionPlan.ok, true);
  assert.equal(review.executionPlan.executor, 'beat_lab');
  assert.equal(review.executionPlan.partial, true);
  assert.ok(review.executionPlan.unhandledDeltas.includes('syncopation'));

  const result = await materializeMusicalPlanReview(review, project);
  assert.equal(result.ok, true);
  assert.equal(result.mutated, true);
  assert.ok(result.project.beatLab.humanize > 0);
});
