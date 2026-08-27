export function onsetTimeSeconds(event) {
  if (typeof event === 'number') return Number.isFinite(event) ? event : null;
  if (!event || typeof event !== 'object') return null;
  const value = Number(event.timeSeconds ?? event.time);
  return Number.isFinite(value) ? value : null;
}

export function normalizeOnsetEvents(input, { minConfidence = 0, minTimeSeconds = 0, maxTimeSeconds = Infinity } = {}) {
  const events = Array.isArray(input) ? input : [];
  return events.map((event, index) => {
    const timeSeconds = onsetTimeSeconds(event);
    if (!Number.isFinite(timeSeconds)) return null;
    const confidence = clamp(Number(typeof event === 'number' ? 1 : (event.confidence ?? 1)), 0, 1);
    const strength = Math.max(0, finite(typeof event === 'number' ? 1 : event.strength, 0));
    return {
      id: String(typeof event === 'number' ? `onset_${index + 1}` : (event.id || `onset_${index + 1}`)),
      timeSeconds,
      confidence,
      strength,
    };
  }).filter((event) => event
    && event.timeSeconds >= minTimeSeconds
    && event.timeSeconds <= maxTimeSeconds
    && event.confidence >= minConfidence)
    .sort((a, b) => a.timeSeconds - b.timeSeconds);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
