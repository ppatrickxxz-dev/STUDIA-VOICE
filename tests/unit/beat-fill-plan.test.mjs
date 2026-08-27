import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBeatFillPlan, placeFillBeforeSection } from '../../packages/app/beat-fill-plan.mjs';

function beatState() {
  return {
    schema: 'pablovoice_beat_lab_v2',
    bpm: 120,
    swing: 0,
    grooveAmount: 0,
    humanize: 0,
    grooveTemplate: { ready: false, stepsPerBar: 16, offsetsBeats: [], accents: [] },
    stepCount: 16,
    lanes: [{
      id: 'lane-snare',
      padId: 'pad-snare',
      label: 'Caixa',
      category: 'snare',
      categoryConfidence: 0.92,
      steps: Array.from({ length: 16 }, () => ({ active: false, velocity: 104 })),
    }],
  };
}

function chorus(startSeconds = 45) {
  return {
    id: `section_chorus_${startSeconds * 1000}`,
    kind: 'chorus',
    label: 'Refrão',
    startSeconds,
    endSeconds: null,
    source: 'user_manual',
    timingStatus: 'confirmed',
    confidence: 1,
  };
}

test('fill plan isolates the final four-step fill window and rebases it to zero', () => {
  const plan = buildBeatFillPlan(beatState(), { intensity: 0.65 });
  assert.equal(plan.ok, true);
  assert.equal(plan.schema, 'pablovoice_beat_fill_plan_v1');
  assert.equal(plan.bpm, 120);
  assert.ok(plan.events.length > 0);
  assert.ok(plan.events.every((event) => event.originalStepIndex >= 12 && event.originalStepIndex <= 15));
  assert.ok(plan.events.every((event) => event.stepIndex >= 0 && event.stepIndex <= 3));
  assert.ok(Math.min(...plan.events.map((event) => event.timeSeconds)) >= 0);
  assert.equal(plan.durationSeconds, 0.5);
});

test('fill planning is deterministic for the same Beat Lab state', () => {
  const first = buildBeatFillPlan(beatState(), { intensity: 0.9 });
  const second = buildBeatFillPlan(beatState(), { intensity: 0.9 });
  const summarize = (plan) => plan.events.map(({ padId, stepIndex, beat, timeSeconds, velocity }) => ({ padId, stepIndex, beat, timeSeconds, velocity }));
  assert.deepEqual(summarize(first), summarize(second));
  assert.equal(first.durationSeconds, second.durationSeconds);
});

test('confirmed section placement makes the rendered track end exactly at section start', () => {
  const plan = buildBeatFillPlan(beatState(), { intensity: 0.65 });
  const placement = placeFillBeforeSection(plan, chorus(45));
  assert.equal(placement.ok, true);
  assert.equal(placement.schema, 'pablovoice_beat_timeline_render_v1');
  assert.equal(placement.kind, 'beat_fill_track');
  assert.equal(placement.endSeconds, 45);
  assert.equal(placement.startSeconds, 44.5);
  assert.equal(placement.startSeconds + placement.durationSeconds, placement.endSeconds);
});

test('placement fails closed without confirmed timing or enough lead time', () => {
  const plan = buildBeatFillPlan(beatState(), { intensity: 0.65 });
  assert.equal(placeFillBeforeSection(plan, { ...chorus(45), timingStatus: 'unconfirmed' }).reason, 'confirmed_section_required');
  const early = placeFillBeforeSection(plan, chorus(0.2));
  assert.equal(early.ok, false);
  assert.equal(early.reason, 'insufficient_lead_time');
});
