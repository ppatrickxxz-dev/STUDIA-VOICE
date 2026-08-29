export const DEFAULT_PPQ = 480;

export function pianoRollPlanToInstrumentNotes(plan = {}, { ppq = DEFAULT_PPQ } = {}) {
  const ticks = Number(ppq);
  if (!Number.isFinite(ticks) || ticks <= 0) throw new TypeError('PPQ inválido.');
  const source = Array.isArray(plan?.pianoRoll) ? plan.pianoRoll : [];
  return source.map((note) => ({
    midi: clamp(Math.round(Number(note?.midi) || 60), 0, 127),
    velocity: clamp(Math.round(Number(note?.velocity) || 96), 1, 127),
    start_beat: Math.max(0, Number(note?.startTick) / ticks || 0),
    duration_beats: Math.max(1 / ticks, Number(note?.durationTicks) / ticks || 0.25),
    source_confidence: clamp(Number(note?.confidence) || 0, 0, 1),
  }));
}

export function applyAudioPlanToInstrumentState(state = {}, plan = {}, { ppq = DEFAULT_PPQ, mode = 'replace' } = {}) {
  const imported = pianoRollPlanToInstrumentNotes(plan, { ppq });
  const current = Array.isArray(state?.notes) ? state.notes.map((note) => ({ ...note })) : [];
  return {
    ...state,
    notes: mode === 'append' ? [...current, ...imported] : imported,
    sourceAssetId: plan?.sourceAssetId || state?.sourceAssetId || null,
    sourceAnalysisSchemaVersion: plan?.analysisSchemaVersion || state?.sourceAnalysisSchemaVersion || null,
    audioToInstrumentImportedAt: imported.length ? Date.now() : state?.audioToInstrumentImportedAt || null,
  };
}

export function summarizeAudioPlan(plan = {}) {
  const notes = Array.isArray(plan?.pianoRoll) ? plan.pianoRoll.length : 0;
  const slices = Array.isArray(plan?.slices) ? plan.slices.length : 0;
  const chromaticReady = plan?.chromatic?.ready === true;
  return { notes, slices, chromaticReady };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
