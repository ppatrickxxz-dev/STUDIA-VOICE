export const REGIONAL_HIGH_SHELF_KIND = 'high_shelf';
export const REGIONAL_PEAKING_EQ_KIND = 'peaking_eq';

export function regionalHighShelfEvents(events = [], cursor = 0, duration = Infinity) {
  return regionalEqEvents(events, REGIONAL_HIGH_SHELF_KIND, cursor, duration).map((event) => normalizeShelfEvent(event));
}

export function regionalPeakingEqEvents(events = [], cursor = 0, duration = Infinity) {
  return regionalEqEvents(events, REGIONAL_PEAKING_EQ_KIND, cursor, duration).map((event) => normalizePeakingEqEvent(event));
}

export function highShelfAutomationPoints(event, cursor = 0, duration = Infinity, ramp = 0.018) {
  return eqAutomationPoints(normalizeShelfEvent(event), cursor, duration, ramp);
}

export function peakingEqAutomationPoints(event, cursor = 0, duration = Infinity, ramp = 0.018) {
  return eqAutomationPoints(normalizePeakingEqEvent(event), cursor, duration, ramp);
}

export function normalizeShelfEvent(event = {}) {
  const normalized = normalizeBaseEqEvent(event, REGIONAL_HIGH_SHELF_KIND);
  return {
    ...normalized,
    frequencyHz: clamp(finite(event.frequencyHz, 6500), 2500, 14000),
    q: clamp(finite(event.q, 1), 0.2, 4),
  };
}

export function normalizePeakingEqEvent(event = {}) {
  const normalized = normalizeBaseEqEvent(event, REGIONAL_PEAKING_EQ_KIND);
  return {
    ...normalized,
    frequencyHz: clamp(finite(event.frequencyHz, 220), 80, 12000),
    q: clamp(finite(event.q, 0.82), 0.35, 6),
  };
}

function regionalEqEvents(events, kind, cursor, duration) {
  const startCursor = Math.max(0, Number(cursor) || 0);
  const endDuration = Number.isFinite(Number(duration)) ? Math.max(startCursor, Number(duration)) : Infinity;
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.enabled !== false && event?.kind === kind)
    .filter((event) => {
      const start = finite(event?.startSeconds, 0);
      const end = finite(event?.endSeconds, start);
      return end > start && end > startCursor && start < endDuration;
    });
}

function eqAutomationPoints(normalized, cursor, duration, ramp) {
  const startCursor = Math.max(0, Number(cursor) || 0);
  const endDuration = Number.isFinite(Number(duration)) ? Math.max(startCursor, Number(duration)) : Infinity;
  if (normalized.endSeconds <= normalized.startSeconds || normalized.endSeconds <= startCursor || normalized.startSeconds >= endDuration) return [];
  const startsInside = startCursor >= normalized.startSeconds && startCursor < normalized.endSeconds;
  const start = Math.max(startCursor, normalized.startSeconds);
  const end = Math.min(endDuration, normalized.endSeconds);
  const edge = Math.min(Math.max(0, Number(ramp) || 0), Math.max(0, (end - start) / 3));
  if (startsInside) {
    return [
      { time: startCursor, value: normalized.gainDb },
      { time: Math.max(startCursor, end - edge), value: normalized.gainDb },
      { time: end, value: 0 },
    ];
  }
  return [
    { time: Math.max(startCursor, start - edge), value: 0 },
    { time: start, value: normalized.gainDb },
    { time: Math.max(start, end - edge), value: normalized.gainDb },
    { time: end, value: 0 },
  ];
}

function normalizeBaseEqEvent(event, kind) {
  const start = Math.max(0, finite(event.startSeconds, 0));
  const end = Math.max(start, finite(event.endSeconds, start));
  return {
    ...event,
    kind,
    startSeconds: start,
    endSeconds: end,
    gainDb: clamp(finite(event.gainDb, 0), -12, 12),
    enabled: event.enabled !== false,
  };
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
