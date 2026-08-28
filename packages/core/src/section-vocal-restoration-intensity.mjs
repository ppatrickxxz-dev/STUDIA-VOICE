import { migrateProject } from './project.mjs';
import { resolveSelectiveVocalRestorationTarget, SELECTIVE_VOCAL_RESTORATION_MODES } from './section-vocal-restoration-selective.mjs';
import { PABLO_SECTION_VOCAL_CLEANUP_SOURCES } from './section-vocal-cleanup.mjs';

export const RESTORATION_INTENSITY_DIRECTIONS = Object.freeze({
  LIGHTER: 'lighter',
  STRONGER: 'stronger',
});

const DENOISE_STEP_DB = 0.75;
const DENOISE_MIN_DB = 0.5;
const DENOISE_MAX_DB = 5.5;
const DEREVERB_STEP = 0.03;
const DEREVERB_MIN = 0.03;
const DEREVERB_MAX = 0.2;

export function parseRestorationIntensityCommand(message = '') {
  const text = normalizeText(message);
  if (!text || /\b(desfaz|desfazer|compara|comparar|aplica|aplicar|faz|fazer|usa|usar)\b/.test(text)) return null;
  const hasDenoise = /\b(denoise|reducao de ruido|ruido de fundo)\b/.test(text);
  const hasDereverb = /\b(de reverb|dereverb|reverb|reverberacao|reflexos? do ambiente)\b/.test(text);
  if (hasDenoise === hasDereverb) return null;
  const lighter = /\b(mais leve|menos forte|menos intenso|reduz um pouco|reduzir um pouco|diminui|diminuir|abaixa|baixar)\b/.test(text);
  const stronger = /\b(mais forte|mais intenso|aumenta|aumentar|reforca|reforcar|sobe um pouco)\b/.test(text);
  if (lighter === stronger) return null;
  const sectionMatch = text.match(/\b(pre[- ]?refrao|refrao|verso|ponte|intro|rap|outro)\b/);
  const section = sectionMatch?.[1] || '';
  if (!section) return null;
  const mode = hasDenoise ? SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE : SELECTIVE_VOCAL_RESTORATION_MODES.DEREVERB;
  return {
    section,
    occurrence: parseOccurrence(text),
    mode,
    direction: lighter ? RESTORATION_INTENSITY_DIRECTIONS.LIGHTER : RESTORATION_INTENSITY_DIRECTIONS.STRONGER,
  };
}

export function planRestorationIntensityAdjustment(project, command) {
  if (!command?.mode || !command?.direction) return { ok: false, reason: 'unsupported_command' };
  const clean = migrateProject(project);
  const target = resolveSelectiveVocalRestorationTarget(clean, command);
  if (!target.ok) return target;
  const source = sourceForMode(command.mode);
  if (!source) return { ...target, ok: false, reason: 'unsupported_mode' };
  const events = (target.track.regionAutomation || []).filter((event) => event?.source === source && belongsToSection(event, target.section.id));
  if (!events.length) return { ...target, ok: false, reason: 'restoration_not_applied', mode: command.mode, source };
  if (!events.every((event) => event?.timbreProtected === true && event?.guardSource === 'bounded-vocal-timbre-guard-v1')) {
    return { ...target, ok: false, reason: 'restoration_not_timbre_protected', mode: command.mode, source };
  }
  const field = command.mode === SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE ? 'reductionDb' : 'amount';
  const adjusted = events.map((event) => ({
    event,
    current: Number(event?.[field]) || 0,
    next: adjustedValue(command.mode, command.direction, Number(event?.[field]) || 0),
  }));
  if (!adjusted.some((item) => Math.abs(item.next - item.current) > 0.000001)) {
    return { ...target, ok: false, reason: 'restoration_at_safe_limit', mode: command.mode, source, field, adjusted };
  }
  return { ...target, ok: true, mode: command.mode, direction: command.direction, source, field, adjusted };
}

export function applyRestorationIntensityAdjustment(project, command, { now = Date.now() } = {}) {
  const plan = planRestorationIntensityAdjustment(project, command);
  if (!plan.ok) return plan;
  const next = plan.project;
  const track = next.tracks.find((candidate) => candidate.id === plan.track.id);
  if (!track) return { ok: false, reason: 'vocal_track_missing' };
  const updates = new Map(plan.adjusted.map((item) => [item.event.id, item.next]));
  track.regionAutomation = (track.regionAutomation || []).map((event) => {
    if (!updates.has(event.id)) return event;
    return {
      ...event,
      [plan.field]: updates.get(event.id),
      intensityAdjustedAt: Number(now) || Date.now(),
    };
  });
  track.updatedAt = Number(now) || Date.now();
  next.updatedAt = track.updatedAt;
  return {
    ...plan,
    project: next,
    track,
    mutated: true,
    changedCount: updates.size,
    values: plan.adjusted.map((item) => ({ id: item.event.id, before: item.current, after: item.next })),
  };
}

function adjustedValue(mode, direction, current) {
  if (mode === SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE) {
    const raw = direction === RESTORATION_INTENSITY_DIRECTIONS.STRONGER ? current + DENOISE_STEP_DB : current - DENOISE_STEP_DB;
    return round(clamp(raw, DENOISE_MIN_DB, DENOISE_MAX_DB), 2);
  }
  const raw = direction === RESTORATION_INTENSITY_DIRECTIONS.STRONGER ? current + DEREVERB_STEP : current - DEREVERB_STEP;
  return round(clamp(raw, DEREVERB_MIN, DEREVERB_MAX), 3);
}

function sourceForMode(mode) {
  if (mode === SELECTIVE_VOCAL_RESTORATION_MODES.DENOISE) return PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DENOISE;
  if (mode === SELECTIVE_VOCAL_RESTORATION_MODES.DEREVERB) return PABLO_SECTION_VOCAL_CLEANUP_SOURCES.DEREVERB;
  return null;
}
function belongsToSection(event, sectionId) { return Boolean(sectionId) && String(event?.id || '').endsWith(`:${sectionId}`); }
function parseOccurrence(text) {
  if (/\b(primeir[oa]|1[oa]?)\b/.test(text)) return 1;
  if (/\b(segund[oa]|2[oa]?)\b/.test(text)) return 2;
  if (/\b(terceir[oa]|3[oa]?)\b/.test(text)) return 3;
  return null;
}
function normalizeText(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[/_-]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function clamp(value, min, max) { return Math.min(max, Math.max(min, Number(value) || 0)); }
function round(value, places) { const factor = 10 ** places; return Math.round(value * factor) / factor; }
