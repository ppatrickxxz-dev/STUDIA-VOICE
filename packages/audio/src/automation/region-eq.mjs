export const REGIONAL_HIGH_SHELF_KIND = 'high_shelf';

export function regionalHighShelfEvents(events = [], cursor = 0, duration = Infinity) {
  const startCursor = Math.max(0, Number(cursor) || 0);
  const endDuration = Number.isFinite(Number(duration)) ? Math.max(startCursor, Number(duration)) : Infinity;
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.enabled !== false && event?.kind === REGIONAL_HIGH_SHELF_KIND)
    .map((event) => normalizeShelfEvent(event))
    .filter((event) => event.endSeconds > event.startSeconds && event.endSeconds > startCursor && event.startSeconds < endDuration);
}

export function highShelfAutomationPoints(event, cursor = 0, duration = Infinity, ramp = 0.018) {
  const normalized = normalizeShelfEvent(event);
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

export function normalizeShelfEvent(event = {}) {
  const start = Math.max(0, finite(event.startSeconds, 0));
  const end = Math.max(start, finite(event.endSeconds, start));
  return {
    ...event,
    kind: REGIONAL_HIGH_SHELF_KIND,
    startSeconds: start,
    endSeconds: end,
    gainDb: clamp(finite(event.gainDb, 0), -12, 12),
    frequencyHz: clamp(finite(event.frequencyHz, 6500), 2500, 14000),
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
