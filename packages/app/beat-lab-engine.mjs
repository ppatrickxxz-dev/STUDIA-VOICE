import { normalizeSamplerState } from './sampler-engine.mjs';

export const BEAT_LAB_SCHEMA = 'pablovoice_beat_lab_v1';
export const BEAT_STEP_COUNTS = Object.freeze([8, 16, 32]);
export const DEFAULT_BEAT_STEPS = 16;
export const DEFAULT_BEAT_VELOCITY = 104;

export function createBeatLabState(sampler, { bpm = 120, stepCount = DEFAULT_BEAT_STEPS, maxLanes = 6 } = {}) {
  const normalizedSampler = normalizeSamplerState(sampler || {});
  const resolvedSteps = normalizeStepCount(stepCount);
  const lanes = normalizedSampler.pads.slice(0, clamp(Math.floor(Number(maxLanes) || 6), 1, 12)).map((pad, index) => ({
    id: `lane_${index + 1}`,
    padId: pad.id,
    label: pad.label || `Pad ${index + 1}`,
    steps: createSteps(resolvedSteps),
  }));
  return {
    schema: BEAT_LAB_SCHEMA,
    bpm: normalizeBpm(bpm),
    swing: 0,
    stepCount: resolvedSteps,
    lanes,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function normalizeBeatLabState(input = {}, sampler = null) {
  const stepCount = normalizeStepCount(input?.stepCount);
  const allowedPadIds = sampler ? new Set(normalizeSamplerState(sampler).pads.map((pad) => pad.id)) : null;
  const lanes = Array.isArray(input?.lanes) ? input.lanes.slice(0, 12).map((lane, index) => normalizeLane(lane, index, stepCount)).filter((lane) => !allowedPadIds || allowedPadIds.has(lane.padId)) : [];
  const fallback = sampler && !lanes.length ? createBeatLabState(sampler, { bpm: input?.bpm, stepCount }) : null;
  if (fallback) {
    fallback.swing = normalizeSwing(input?.swing);
    fallback.createdAt = finite(input?.createdAt, fallback.createdAt);
    fallback.updatedAt = finite(input?.updatedAt, fallback.updatedAt);
    return fallback;
  }
  return {
    schema: BEAT_LAB_SCHEMA,
    bpm: normalizeBpm(input?.bpm),
    swing: normalizeSwing(input?.swing),
    stepCount,
    lanes,
    createdAt: finite(input?.createdAt, Date.now()),
    updatedAt: finite(input?.updatedAt, Date.now()),
  };
}

export function toggleBeatStep(state, laneId, stepIndex) {
  const clean = normalizeBeatLabState(state);
  const index = normalizeStepIndex(stepIndex, clean.stepCount);
  if (index < 0) return clean;
  clean.lanes = clean.lanes.map((lane) => lane.id === laneId ? {
    ...lane,
    steps: lane.steps.map((step, current) => current === index ? { ...step, active: !step.active } : step),
  } : lane);
  clean.updatedAt = Date.now();
  return clean;
}

export function setBeatStepVelocity(state, laneId, stepIndex, velocity) {
  const clean = normalizeBeatLabState(state);
  const index = normalizeStepIndex(stepIndex, clean.stepCount);
  if (index < 0) return clean;
  clean.lanes = clean.lanes.map((lane) => lane.id === laneId ? {
    ...lane,
    steps: lane.steps.map((step, current) => current === index ? { ...step, velocity: normalizeVelocity(velocity) } : step),
  } : lane);
  clean.updatedAt = Date.now();
  return clean;
}

export function setBeatBpm(state, bpm) {
  const clean = normalizeBeatLabState(state);
  clean.bpm = normalizeBpm(bpm);
  clean.updatedAt = Date.now();
  return clean;
}

export function setBeatSwing(state, swing) {
  const clean = normalizeBeatLabState(state);
  clean.swing = normalizeSwing(swing);
  clean.updatedAt = Date.now();
  return clean;
}

export function setBeatStepCount(state, stepCount) {
  const clean = normalizeBeatLabState(state);
  const nextCount = normalizeStepCount(stepCount);
  clean.stepCount = nextCount;
  clean.lanes = clean.lanes.map((lane) => ({
    ...lane,
    steps: resizeSteps(lane.steps, nextCount),
  }));
  clean.updatedAt = Date.now();
  return clean;
}

export function duplicateBeatPattern(state) {
  const clean = normalizeBeatLabState(state);
  if (clean.stepCount >= 32) return clean;
  const nextCount = clean.stepCount <= 8 ? 16 : 32;
  clean.lanes = clean.lanes.map((lane) => {
    const source = lane.steps.slice(0, clean.stepCount).map((step) => ({ ...step }));
    const steps = [...source, ...source.map((step) => ({ ...step }))].slice(0, nextCount);
    return { ...lane, steps };
  });
  clean.stepCount = nextCount;
  clean.updatedAt = Date.now();
  return clean;
}

export function clearBeatPattern(state) {
  const clean = normalizeBeatLabState(state);
  clean.lanes = clean.lanes.map((lane) => ({ ...lane, steps: createSteps(clean.stepCount) }));
  clean.updatedAt = Date.now();
  return clean;
}

export function sequenceBeatEvents(state) {
  const clean = normalizeBeatLabState(state);
  const secondsPerBeat = 60 / clean.bpm;
  const events = [];
  for (const lane of clean.lanes) {
    lane.steps.forEach((step, stepIndex) => {
      if (!step.active) return;
      const baseBeat = stepIndex * 0.25;
      const swingDelayBeats = stepIndex % 2 === 1 ? clean.swing * 0.125 : 0;
      const beat = baseBeat + swingDelayBeats;
      events.push({
        laneId: lane.id,
        padId: lane.padId,
        stepIndex,
        velocity: step.velocity,
        beat,
        timeSeconds: beat * secondsPerBeat,
      });
    });
  }
  return events.sort((a, b) => a.timeSeconds - b.timeSeconds || a.laneId.localeCompare(b.laneId));
}

export function beatPatternDurationSeconds(state) {
  const clean = normalizeBeatLabState(state);
  return clean.stepCount * 0.25 * (60 / clean.bpm);
}

export function activeBeatStepCount(state) {
  return normalizeBeatLabState(state).lanes.reduce((sum, lane) => sum + lane.steps.filter((step) => step.active).length, 0);
}

function normalizeLane(input = {}, index = 0, stepCount = DEFAULT_BEAT_STEPS) {
  return {
    id: String(input?.id || `lane_${index + 1}`),
    padId: String(input?.padId || ''),
    label: String(input?.label || `Pad ${index + 1}`).slice(0, 40),
    steps: resizeSteps(input?.steps, stepCount),
  };
}

function createSteps(count) {
  return Array.from({ length: count }, () => ({ active: false, velocity: DEFAULT_BEAT_VELOCITY }));
}

function resizeSteps(input, count) {
  const source = Array.isArray(input) ? input : [];
  return Array.from({ length: count }, (_, index) => normalizeStep(source[index]));
}

function normalizeStep(input = {}) {
  return {
    active: Boolean(input?.active),
    velocity: normalizeVelocity(input?.velocity),
  };
}

function normalizeVelocity(value) {
  return clamp(Math.round(finite(value, DEFAULT_BEAT_VELOCITY)), 1, 127);
}

function normalizeBpm(value) {
  return clamp(Math.round(finite(value, 120)), 40, 240);
}

function normalizeSwing(value) {
  return clamp(finite(value, 0), 0, 1);
}

function normalizeStepCount(value) {
  const requested = Math.round(finite(value, DEFAULT_BEAT_STEPS));
  return BEAT_STEP_COUNTS.includes(requested) ? requested : DEFAULT_BEAT_STEPS;
}

function normalizeStepIndex(value, count) {
  const index = Math.floor(Number(value));
  return Number.isInteger(index) && index >= 0 && index < count ? index : -1;
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
