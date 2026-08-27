import { confidenceDecision } from '../contracts/confidence.mjs';

export function createProjectMixState({ projectId, tracks = [], relations = [] } = {}) {
  if (!projectId) throw new Error('projectId is required');
  return {
    version: 1,
    projectId,
    measuredAt: new Date().toISOString(),
    tracks: tracks.map(normalizeTrack),
    relations,
    intents: [],
    confidence: aggregateConfidence(tracks)
  };
}

export function registerMixIntent(state, intent) {
  if (!state?.projectId) throw new Error('mix state is required');
  const normalized = { ...intent, decision: confidenceDecision(intent?.confidence) };
  state.intents.push(normalized);
  return normalized;
}

function normalizeTrack(track = {}) {
  return {
    trackId: track.trackId || track.id || null,
    role: track.role || 'unknown',
    loudnessLufs: finiteOrNull(track.loudnessLufs),
    peak: finiteOrNull(track.peak),
    spectralEnvelope: Array.isArray(track.spectralEnvelope) ? track.spectralEnvelope : [],
    foreground: finiteOrNull(track.foreground),
    analysisConfidence: finiteOrNull(track.analysisConfidence)
  };
}

function aggregateConfidence(tracks) {
  const values = tracks.map((t) => Number(t.analysisConfidence)).filter(Number.isFinite);
  return values.length ? values.reduce((a,b)=>a+b,0) / values.length : null;
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
