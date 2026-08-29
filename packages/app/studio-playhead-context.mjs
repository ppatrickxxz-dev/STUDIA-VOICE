const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;
const playheads = new Map();

export function recordStudioPlayhead(projectId, seconds, now = Date.now()) {
  const id = String(projectId || '').trim();
  const value = Number(seconds);
  const capturedAt = Number(now);
  if (!id || !Number.isFinite(value) || value <= 0 || !Number.isFinite(capturedAt)) return null;
  const record = Object.freeze({
    projectId: id,
    seconds: Math.round(value * 1000) / 1000,
    capturedAt,
  });
  playheads.set(id, record);
  return record;
}

export function readStudioPlayhead(projectId, {
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS,
} = {}) {
  const id = String(projectId || '').trim();
  if (!id) return { ok: false, reason: 'project_required', projectId: null };
  const record = playheads.get(id);
  if (!record) return { ok: false, reason: 'playhead_missing', projectId: id };
  const ageMs = Math.max(0, Number(now) - record.capturedAt);
  const ageLimit = Math.max(1000, Number(maxAgeMs) || DEFAULT_MAX_AGE_MS);
  if (!Number.isFinite(ageMs) || ageMs > ageLimit) {
    return { ok: false, reason: 'playhead_stale', projectId: id, capturedAt: record.capturedAt, ageMs };
  }
  return { ok: true, ...record, ageMs };
}

export function clearStudioPlayhead(projectId = '') {
  const id = String(projectId || '').trim();
  if (!id) {
    playheads.clear();
    return true;
  }
  return playheads.delete(id);
}

export function studioPlayheadMaxAgeMs() {
  return DEFAULT_MAX_AGE_MS;
}
