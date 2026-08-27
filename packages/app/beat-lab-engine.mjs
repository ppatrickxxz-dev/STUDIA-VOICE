import { normalizeGrooveTemplate } from './audio/src/sampler/groove-template.mjs';
import { normalizeSamplerState } from './sampler-engine.mjs';

export const BEAT_LAB_SCHEMA = 'pablovoice_beat_lab_v2';
export const BEAT_STEP_COUNTS = Object.freeze([8, 16, 32]);
export const DEFAULT_BEAT_STEPS = 16;
export const DEFAULT_BEAT_VELOCITY = 104;

const CATEGORY_ORDER = Object.freeze(['kick', 'snare', 'clap', 'closed_hat', 'open_hat', 'percussion', 'unknown']);
const CATEGORY_LABELS = Object.freeze({
  kick: 'Kick',
  snare: 'Caixa',
  clap: 'Clap',
  closed_hat: 'Chimbal fechado',
  open_hat: 'Chimbal aberto',
  percussion: 'Percussão',
  unknown: 'Sample',
});

export function createBeatLabState(sampler, { bpm = 120, stepCount = DEFAULT_BEAT_STEPS, maxLanes = 6 } = {}) {
  const normalizedSampler = normalizeSamplerState(sampler || {});
  const resolvedSteps = normalizeStepCount(stepCount);
  const lanes = buildSemanticLanes(normalizedSampler, resolvedSteps, maxLanes);
  return {
    schema: BEAT_LAB_SCHEMA,
    bpm: normalizeBpm(bpm || normalizedSampler.grooveTemplate?.bpm),
    swing: 0,
    grooveAmount: 0,
    humanize: 0,
    grooveTemplate: normalizeGrooveTemplate(normalizedSampler.grooveTemplate || {}),
    stepCount: resolvedSteps,
    lanes,
    lastOperation: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function normalizeBeatLabState(input = {}, sampler = null) {
  const stepCount = normalizeStepCount(input?.stepCount);
  const normalizedSampler = sampler ? normalizeSamplerState(sampler) : null;
  const allowedPadIds = normalizedSampler ? new Set(normalizedSampler.pads.map((pad) => pad.id)) : null;
  const padById = normalizedSampler ? new Map(normalizedSampler.pads.map((pad) => [pad.id, pad])) : new Map();
  let lanes = Array.isArray(input?.lanes)
    ? input.lanes.slice(0, 12).map((lane, index) => normalizeLane(lane, index, stepCount, padById.get(lane?.padId))).filter((lane) => !allowedPadIds || allowedPadIds.has(lane.padId))
    : [];
  if (normalizedSampler && !lanes.length) lanes = buildSemanticLanes(normalizedSampler, stepCount, 6);
  const inheritedGroove = normalizedSampler?.grooveTemplate || {};
  return {
    schema: BEAT_LAB_SCHEMA,
    bpm: normalizeBpm(input?.bpm || inheritedGroove?.bpm),
    swing: normalizeAmount(input?.swing),
    grooveAmount: normalizeAmount(input?.grooveAmount),
    humanize: normalizeAmount(input?.humanize),
    grooveTemplate: normalizeGrooveTemplate(input?.grooveTemplate || inheritedGroove),
    stepCount,
    lanes,
    lastOperation: normalizeLastOperation(input?.lastOperation),
    createdAt: finite(input?.createdAt, Date.now()),
    updatedAt: finite(input?.updatedAt, Date.now()),
  };
}

export function refreshBeatLanesFromSampler(state, sampler, { maxLanes = 6 } = {}) {
  const clean = normalizeBeatLabState(state, sampler);
  const normalizedSampler = normalizeSamplerState(sampler || {});
  const priorByPad = new Map(clean.lanes.map((lane) => [lane.padId, lane]));
  const selected = selectSemanticPads(normalizedSampler.pads, maxLanes);
  clean.lanes = selected.map((pad, index) => {
    const prior = priorByPad.get(pad.id);
    if (prior) return normalizeLane({ ...prior, label: semanticLaneLabel(pad), category: pad.category, categoryConfidence: pad.categoryConfidence }, index, clean.stepCount, pad);
    return normalizeLane({
      id: `lane_${index + 1}_${safeId(pad.id)}`,
      padId: pad.id,
      label: semanticLaneLabel(pad),
      category: pad.category,
      categoryConfidence: pad.categoryConfidence,
      steps: createSteps(clean.stepCount),
    }, index, clean.stepCount, pad);
  });
  clean.grooveTemplate = normalizeGrooveTemplate(normalizedSampler.grooveTemplate || clean.grooveTemplate);
  clean.lastOperation = { kind: 'organize_lanes', ok: true, at: Date.now() };
  clean.updatedAt = Date.now();
  return clean;
}

export function selectSemanticPads(pads = [], maxLanes = 6) {
  const limit = clamp(Math.floor(Number(maxLanes) || 6), 1, 12);
  const source = Array.isArray(pads) ? pads.slice() : [];
  const ranked = source.sort((a, b) => {
    const ca = categoryRank(a?.category);
    const cb = categoryRank(b?.category);
    if (ca !== cb) return ca - cb;
    const confidenceDiff = Number(b?.categoryConfidence || 0) - Number(a?.categoryConfidence || 0);
    if (Math.abs(confidenceDiff) > 1e-9) return confidenceDiff;
    return Number(a?.start || 0) - Number(b?.start || 0);
  });
  const selected = [];
  const used = new Set();
  for (const category of CATEGORY_ORDER) {
    const match = ranked.find((pad) => normalizeCategory(pad?.category) === category && !used.has(pad.id));
    if (!match) continue;
    selected.push(match);
    used.add(match.id);
    if (selected.length >= limit) return selected;
  }
  for (const pad of ranked) {
    if (used.has(pad.id)) continue;
    selected.push(pad);
    used.add(pad.id);
    if (selected.length >= limit) break;
  }
  return selected;
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
  clean.swing = normalizeAmount(swing);
  clean.updatedAt = Date.now();
  return clean;
}

export function setBeatGrooveAmount(state, amount) {
  const clean = normalizeBeatLabState(state);
  clean.grooveAmount = clean.grooveTemplate?.ready ? normalizeAmount(amount) : 0;
  clean.updatedAt = Date.now();
  return clean;
}

export function setBeatHumanize(state, amount) {
  const clean = normalizeBeatLabState(state);
  clean.humanize = normalizeAmount(amount);
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
  clean.lastOperation = { kind: 'clear', ok: true, at: Date.now() };
  clean.updatedAt = Date.now();
  return clean;
}

export function generateBeatFill(state, { intensity = 0.65 } = {}) {
  const clean = normalizeBeatLabState(state);
  const candidates = clean.lanes.filter((lane) => ['snare', 'clap', 'percussion', 'closed_hat', 'open_hat'].includes(lane.category))
    .sort((a, b) => fillCategoryRank(a.category) - fillCategoryRank(b.category) || b.categoryConfidence - a.categoryConfidence);
  const lane = candidates[0];
  if (!lane) {
    clean.lastOperation = { kind: 'fill', ok: false, reason: 'no_percussive_lane', at: Date.now() };
    clean.updatedAt = Date.now();
    return clean;
  }
  const amount = normalizeAmount(intensity);
  const start = Math.max(0, clean.stepCount - 4);
  const activeOffsets = amount < 0.4 ? [2, 3] : amount < 0.75 ? [0, 2, 3] : [0, 1, 2, 3];
  const velocities = [84, 92, 104, 120];
  clean.lanes = clean.lanes.map((item) => {
    if (item.id !== lane.id) return item;
    return {
      ...item,
      steps: item.steps.map((step, index) => {
        const offset = index - start;
        if (!activeOffsets.includes(offset)) return step;
        return { ...step, active: true, velocity: velocities[offset] || DEFAULT_BEAT_VELOCITY };
      }),
    };
  });
  clean.lastOperation = { kind: 'fill', ok: true, laneId: lane.id, category: lane.category, intensity: amount, at: Date.now() };
  clean.updatedAt = Date.now();
  return clean;
}

export function sequenceBeatEvents(state) {
  const clean = normalizeBeatLabState(state);
  const secondsPerBeat = 60 / clean.bpm;
  const template = clean.grooveTemplate?.ready ? clean.grooveTemplate : null;
  const events = [];
  for (const lane of clean.lanes) {
    lane.steps.forEach((step, stepIndex) => {
      if (!step.active) return;
      const baseBeat = stepIndex * 0.25;
      const swingDelayBeats = stepIndex % 2 === 1 ? clean.swing * 0.125 : 0;
      const templateIndex = template ? stepIndex % template.stepsPerBar : 0;
      const grooveOffsetBeats = template ? finite(template.offsetsBeats?.[templateIndex], 0) * clean.grooveAmount : 0;
      const timingJitterBeats = deterministicCentered(`${lane.padId}:${stepIndex}:timing`) * 0.03 * clean.humanize;
      const rawBeat = baseBeat + swingDelayBeats + grooveOffsetBeats + timingJitterBeats;
      const beat = Math.max(0, rawBeat);
      const accent = template ? finite(template.accents?.[templateIndex], 0) : 0;
      const grooveVelocity = (accent - 0.5) * 10 * clean.grooveAmount;
      const humanVelocity = deterministicCentered(`${lane.padId}:${stepIndex}:velocity`) * 10 * clean.humanize;
      const velocity = normalizeVelocity(step.velocity + grooveVelocity + humanVelocity);
      events.push({
        laneId: lane.id,
        padId: lane.padId,
        category: lane.category,
        stepIndex,
        sourceVelocity: step.velocity,
        velocity,
        beat,
        timeSeconds: beat * secondsPerBeat,
        timing: {
          baseBeat,
          swingDelayBeats,
          grooveOffsetBeats,
          humanizeOffsetBeats: timingJitterBeats,
        },
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

function buildSemanticLanes(sampler, stepCount, maxLanes) {
  return selectSemanticPads(sampler.pads, maxLanes).map((pad, index) => normalizeLane({
    id: `lane_${index + 1}_${safeId(pad.id)}`,
    padId: pad.id,
    label: semanticLaneLabel(pad),
    category: pad.category,
    categoryConfidence: pad.categoryConfidence,
    steps: createSteps(stepCount),
  }, index, stepCount, pad));
}

function normalizeLane(input = {}, index = 0, stepCount = DEFAULT_BEAT_STEPS, pad = null) {
  const category = normalizeCategory(pad?.category ?? input?.category);
  const label = pad ? semanticLaneLabel(pad) : String(input?.label || CATEGORY_LABELS[category] || `Pad ${index + 1}`).slice(0, 60);
  return {
    id: String(input?.id || `lane_${index + 1}`),
    padId: String(input?.padId || pad?.id || ''),
    label,
    category,
    categoryConfidence: clamp(finite(pad?.categoryConfidence ?? input?.categoryConfidence, 0), 0, 1),
    steps: resizeSteps(input?.steps, stepCount),
  };
}

function semanticLaneLabel(pad = {}) {
  const category = normalizeCategory(pad.category);
  const base = CATEGORY_LABELS[category] || 'Sample';
  const padLabel = String(pad.label || '').trim();
  if (!padLabel || /^Pad \d+$/i.test(padLabel)) return base;
  return `${base} · ${padLabel}`.slice(0, 60);
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

function normalizeAmount(value) {
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

function normalizeCategory(value) {
  const category = String(value || 'unknown');
  return CATEGORY_ORDER.includes(category) ? category : 'unknown';
}

function normalizeLastOperation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    kind: String(value.kind || '').slice(0, 40),
    ok: Boolean(value.ok),
    reason: value.reason ? String(value.reason).slice(0, 80) : null,
    laneId: value.laneId ? String(value.laneId).slice(0, 80) : null,
    category: value.category ? normalizeCategory(value.category) : null,
    intensity: value.intensity == null ? null : normalizeAmount(value.intensity),
    at: finite(value.at, Date.now()),
  };
}

function categoryRank(category) {
  const index = CATEGORY_ORDER.indexOf(normalizeCategory(category));
  return index >= 0 ? index : CATEGORY_ORDER.length;
}

function fillCategoryRank(category) {
  return ['snare', 'clap', 'percussion', 'closed_hat', 'open_hat'].indexOf(normalizeCategory(category));
}

function deterministicCentered(seed) {
  let hash = 2166136261;
  const text = String(seed || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * 2 - 1;
}

function safeId(value) {
  return String(value || 'pad').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
