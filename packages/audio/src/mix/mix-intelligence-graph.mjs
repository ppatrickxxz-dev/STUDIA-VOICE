import { confidenceDecision, normalizeConfidence } from '../contracts/confidence.mjs';

export function buildProjectMixState({ tracks = [] } = {}) {
  const normalizedTracks = tracks.filter(Boolean).map(normalizeTrack);
  const relations = [];
  for (let i = 0; i < normalizedTracks.length; i += 1) {
    for (let j = i + 1; j < normalizedTracks.length; j += 1) {
      relations.push(analyzeTrackRelation(normalizedTracks[i], normalizedTracks[j]));
    }
  }
  return {
    schemaVersion: 1,
    tracks: normalizedTracks,
    relations,
    foreground: normalizedTracks.filter((t) => t.role === 'lead-vocal' || t.intent?.depth === 'front').map((t) => t.trackId),
    confidence: average(relations.map((r) => r.confidence)),
  };
}

export function analyzeTrackRelation(a, b) {
  const loudnessDeltaDb = finite(a.loudnessLufs) && finite(b.loudnessLufs) ? a.loudnessLufs - b.loudnessLufs : null;
  const overlap = spectralOverlap(a.spectralEnvelope, b.spectralEnvelope);
  const maskingRisk = overlap === null ? null : clamp01(overlap * (loudnessDeltaDb === null ? 0.75 : 1 - Math.min(12, Math.abs(loudnessDeltaDb)) / 24));
  const evidence = [a.confidence, b.confidence, overlap === null ? null : 0.85].filter(finite);
  const confidence = average(evidence);
  return {
    a: a.trackId,
    b: b.trackId,
    loudnessDeltaDb,
    spectralOverlap: overlap,
    maskingRisk,
    confidence,
    decision: confidenceDecision(confidence),
  };
}

export function planMixIntent(state, intent, { targetTrackId = null } = {}) {
  if (!state?.tracks?.length) throw new Error('project mix state is required');
  const target = state.tracks.find((t) => t.trackId === targetTrackId) || state.tracks.find((t) => t.role === 'lead-vocal');
  if (!target) return { intent, targetTrackId: null, actions: [], confidence: 0, decision: 'manual' };
  const related = state.relations.filter((r) => r.a === target.trackId || r.b === target.trackId);
  const conflicts = related.filter((r) => finite(r.maskingRisk) && r.maskingRisk >= 0.45).sort((a,b) => (b.maskingRisk || 0) - (a.maskingRisk || 0));
  const confidence = average([target.confidence, ...conflicts.map((r) => r.confidence)]);
  const actions = [];
  if (intent === 'bring-forward' || intent === 'voice-forward') {
    actions.push({ type: 'gain', trackId: target.trackId, deltaDb: 1.5, destructive: false });
    for (const relation of conflicts.slice(0, 3)) {
      const other = relation.a === target.trackId ? relation.b : relation.a;
      actions.push({ type: 'dynamic-space', trackId: other, sidechainFrom: target.trackId, amount: Math.min(1, relation.maskingRisk), destructive: false });
    }
    actions.push({ type: 'reverb-depth', trackId: target.trackId, direction: 'drier', amount: 0.2, destructive: false });
  }
  return { intent, targetTrackId: target.trackId, actions, conflicts, confidence, decision: confidenceDecision(confidence) };
}

function normalizeTrack(track) {
  const analysis = track.analysis || {};
  return {
    trackId: String(track.trackId || track.id || ''),
    role: track.role || 'unknown',
    intent: track.intent || {},
    loudnessLufs: featureValue(analysis.signal?.loudnessLufs),
    spectralEnvelope: Array.isArray(analysis.signal?.spectralEnvelope) ? analysis.signal.spectralEnvelope : [],
    confidence: normalizeConfidence(track.confidence ?? analysis.confidence?.voice ?? analysis.confidence?.pitch) ?? 0,
  };
}

function spectralOverlap(a = [], b = []) {
  if (!a.length || !b.length) return null;
  const n = Math.min(a.length, b.length);
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i += 1) {
    const av = Number(a[i]?.value ?? a[i]) || 0;
    const bv = Number(b[i]?.value ?? b[i]) || 0;
    dot += av * bv; aa += av * av; bb += bv * bv;
  }
  if (!aa || !bb) return null;
  return clamp01(dot / Math.sqrt(aa * bb));
}

function featureValue(feature) { return finite(feature?.value) ? feature.value : finite(feature) ? feature : null; }
function average(values) { const xs = values.filter(finite); return xs.length ? xs.reduce((a,b)=>a+b,0) / xs.length : 0; }
function finite(v) { return Number.isFinite(Number(v)); }
function clamp01(v) { return Math.max(0, Math.min(1, Number(v) || 0)); }
