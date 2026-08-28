export const REGIONAL_COMPRESSOR_KIND = 'compressor';

export function regionalCompressorEvents(events = [], cursor = 0, duration = Infinity) {
  const startCursor = Math.max(0, Number(cursor) || 0);
  const endDuration = Number.isFinite(Number(duration)) ? Math.max(startCursor, Number(duration)) : Infinity;
  return (Array.isArray(events) ? events : [])
    .filter((event) => event?.enabled !== false && event?.kind === REGIONAL_COMPRESSOR_KIND)
    .map((event) => normalizeCompressorEvent(event))
    .filter((event) => event.endSeconds > event.startSeconds && event.endSeconds > startCursor && event.startSeconds < endDuration);
}

export function compressorAutomationPoints(event, cursor = 0, duration = Infinity, ramp = 0.018) {
  const normalized = normalizeCompressorEvent(event);
  const startCursor = Math.max(0, Number(cursor) || 0);
  const endDuration = Number.isFinite(Number(duration)) ? Math.max(startCursor, Number(duration)) : Infinity;
  if (normalized.endSeconds <= normalized.startSeconds || normalized.endSeconds <= startCursor || normalized.startSeconds >= endDuration) return [];
  const startsInside = startCursor >= normalized.startSeconds && startCursor < normalized.endSeconds;
  const start = Math.max(startCursor, normalized.startSeconds);
  const end = Math.min(endDuration, normalized.endSeconds);
  const edge = Math.min(Math.max(0, Number(ramp) || 0), Math.max(0, (end - start) / 3));
  const active = { thresholdDb: normalized.thresholdDb, ratio: normalized.ratio };
  const bypass = { thresholdDb: 0, ratio: 1 };
  if (startsInside) {
    return [
      { time: startCursor, ...active },
      { time: Math.max(startCursor, end - edge), ...active },
      { time: end, ...bypass },
    ];
  }
  return [
    { time: Math.max(startCursor, start - edge), ...bypass },
    { time: start, ...active },
    { time: Math.max(start, end - edge), ...active },
    { time: end, ...bypass },
  ];
}

export function normalizeCompressorEvent(event = {}) {
  const start = Math.max(0, finite(event.startSeconds, 0));
  const end = Math.max(start, finite(event.endSeconds, start));
  return {
    ...event,
    kind: REGIONAL_COMPRESSOR_KIND,
    startSeconds: start,
    endSeconds: end,
    thresholdDb: clamp(finite(event.thresholdDb, -18), -36, -6),
    ratio: clamp(finite(event.ratio, 2.2), 1, 6),
    kneeDb: clamp(finite(event.kneeDb, 6), 0, 20),
    attackSeconds: clamp(finite(event.attackSeconds, 0.006), 0.001, 0.08),
    releaseSeconds: clamp(finite(event.releaseSeconds, 0.12), 0.03, 0.8),
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
