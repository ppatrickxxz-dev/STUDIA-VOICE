export function analyzeTempo(onsets = [], { minBpm = 60, maxBpm = 200, durationSeconds = null } = {}) {
  const times = onsets
    .map((event) => typeof event === 'number' ? event : event?.time ?? event?.timeSeconds ?? event?.startSeconds)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a,b)=>a-b);
  if (times.length < 2) return { bpm: null, confidence: 0, beats: [], tempoMap: [] };
  const intervals = [];
  for (let i = 1; i < times.length; i++) {
    const delta = times[i] - times[i - 1];
    if (delta > 0.08 && delta < 2.5) intervals.push(delta);
  }
  if (!intervals.length) return { bpm: null, confidence: 0, beats: [], tempoMap: [] };
  const candidates = intervals.map((seconds) => normalizeBpm(60 / seconds, minBpm, maxBpm));
  const histogram = new Map();
  for (const bpm of candidates) {
    const bin = Math.round(bpm);
    histogram.set(bin, (histogram.get(bin) || 0) + 1);
  }
  const [bestBin, bestCount] = [...histogram.entries()].sort((a,b)=>b[1]-a[1])[0];
  const matching = candidates.filter((bpm) => Math.abs(bpm - bestBin) <= 1.5);
  const bpm = matching.reduce((sum, value) => sum + value, 0) / matching.length;
  const confidence = Math.min(1, bestCount / intervals.length);
  const period = 60 / bpm;
  const start = times[0];
  const inferredDuration = Number.isFinite(durationSeconds) ? durationSeconds : times.at(-1) + period;
  const beats = [];
  for (let time = start, index = 0; time <= inferredDuration + 1e-6; time += period, index++) {
    beats.push({ time, index, confidence });
  }
  return { bpm, confidence, beats, tempoMap: [{ start: 0, end: inferredDuration, bpm, confidence }] };
}

function normalizeBpm(bpm, minBpm, maxBpm) {
  let value = bpm;
  while (value < minBpm) value *= 2;
  while (value > maxBpm) value /= 2;
  return value;
}
