export function regionGainEnvelope(events = [], cursor = 0, duration = Infinity, ramp = 0.012) {
  const points = [];
  for (const event of events) {
    if (event?.enabled === false) continue;
    const start = Number(event?.startSeconds);
    const end = Number(event?.endSeconds);
    const db = Number(event?.gainDb);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(db) || end <= start || end <= cursor || start >= duration) continue;
    const boundedStart = Math.max(cursor, start);
    const boundedEnd = Math.min(duration, end);
    const gain = dbToGain(db);
    const edge = Math.min(ramp, Math.max(0, (boundedEnd - boundedStart) / 3));
    points.push(
      { time: Math.max(cursor, boundedStart - edge), value: 1 },
      { time: boundedStart, value: gain },
      { time: Math.max(boundedStart, boundedEnd - edge), value: gain },
      { time: boundedEnd, value: 1 },
    );
  }
  return points.sort((a, b) => a.time - b.time);
}

export function dbToGain(db) {
  return 10 ** (Math.max(-60, Math.min(12, Number(db) || 0)) / 20);
}
