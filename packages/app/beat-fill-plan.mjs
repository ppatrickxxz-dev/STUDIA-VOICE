import {
  clearBeatPattern,
  generateBeatFill,
  normalizeBeatLabState,
  sequenceBeatEvents,
} from './beat-lab-engine.mjs';

export const BEAT_FILL_PLAN_SCHEMA = 'pablovoice_beat_fill_plan_v1';
export const BEAT_TIMELINE_RENDER_SCHEMA = 'pablovoice_beat_timeline_render_v1';

export function buildBeatFillPlan(state, { intensity = 0.65 } = {}) {
  const base = normalizeBeatLabState(state || {});
  let fillState = clearBeatPattern(base);
  fillState = generateBeatFill(fillState, { intensity });
  if (!fillState.lastOperation?.ok) {
    return {
      ok: false,
      reason: fillState.lastOperation?.reason || 'no_percussive_lane',
      schema: BEAT_FILL_PLAN_SCHEMA,
      events: [],
    };
  }

  const secondsPerBeat = 60 / fillState.bpm;
  const firstFillStep = Math.max(0, fillState.stepCount - 4);
  const fillStartBeat = firstFillStep * 0.25;
  const rawEvents = sequenceBeatEvents(fillState).filter((event) => event.stepIndex >= firstFillStep);
  const events = rawEvents.map((event) => {
    const beat = Math.max(0, Number(event.beat || 0) - fillStartBeat);
    return {
      ...event,
      originalStepIndex: event.stepIndex,
      stepIndex: event.stepIndex - firstFillStep,
      beat,
      timeSeconds: beat * secondsPerBeat,
    };
  });
  if (!events.length) {
    return { ok: false, reason: 'empty_fill', schema: BEAT_FILL_PLAN_SCHEMA, events: [] };
  }

  const maxEventTime = Math.max(...events.map((event) => Number(event.timeSeconds || 0)));
  const durationSeconds = roundMillis(Math.min(
    secondsPerBeat * 1.25,
    Math.max(secondsPerBeat, maxEventTime + 0.04),
  ));

  return {
    ok: true,
    schema: BEAT_FILL_PLAN_SCHEMA,
    bpm: fillState.bpm,
    intensity: clamp(Number(intensity), 0, 1),
    category: fillState.lastOperation?.category || null,
    laneId: fillState.lastOperation?.laneId || null,
    durationSeconds,
    events,
  };
}

export function placeFillBeforeSection(fillPlan, section = {}) {
  if (!fillPlan?.ok || !Array.isArray(fillPlan.events) || !fillPlan.events.length) {
    return { ok: false, reason: fillPlan?.reason || 'fill_plan_required' };
  }
  const targetStartSeconds = Number(section?.startSeconds);
  if (!Number.isFinite(targetStartSeconds) || targetStartSeconds < 0 || section?.timingStatus !== 'confirmed') {
    return { ok: false, reason: 'confirmed_section_required' };
  }
  if (targetStartSeconds + 1e-6 < fillPlan.durationSeconds) {
    return {
      ok: false,
      reason: 'insufficient_lead_time',
      requiredSeconds: fillPlan.durationSeconds,
      availableSeconds: targetStartSeconds,
    };
  }

  return {
    ok: true,
    schema: BEAT_TIMELINE_RENDER_SCHEMA,
    kind: 'beat_fill_track',
    operation: 'fill_before_section',
    targetSectionId: String(section.id || ''),
    targetSectionKind: String(section.kind || ''),
    targetSectionLabel: String(section.label || 'Seção'),
    targetStartSeconds: roundMillis(targetStartSeconds),
    startSeconds: roundMillis(targetStartSeconds - fillPlan.durationSeconds),
    endSeconds: roundMillis(targetStartSeconds),
    durationSeconds: fillPlan.durationSeconds,
    bpm: fillPlan.bpm,
    intensity: fillPlan.intensity,
    category: fillPlan.category,
    laneId: fillPlan.laneId,
    events: structuredClone(fillPlan.events),
  };
}

function roundMillis(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
