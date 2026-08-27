export function createSlicesFromAnalysis(analysis, { minConfidence = 0.45, minSliceSeconds = 0.04 } = {}) {
  const onsets = analysis?.signal?.onsets || analysis?.onsets || [];
  const duration = Number(analysis?.source?.durationSeconds ?? analysis?.durationSeconds);
  const points = onsets
    .map((event) => typeof event === 'number' ? { time: event, confidence: 1 } : event)
    .filter((event) => Number.isFinite(event?.time) && (Number(event.confidence ?? 1) >= minConfidence))
    .sort((a,b)=>a.time-b.time);
  const boundaries = [0, ...points.map((event)=>event.time)];
  if (Number.isFinite(duration)) boundaries.push(duration);
  const unique = [...new Set(boundaries.filter((time)=>time >= 0))].sort((a,b)=>a-b);
  const slices = [];
  for (let i = 0; i < unique.length - 1; i++) {
    const start = unique[i];
    const end = unique[i + 1];
    if (end - start < minSliceSeconds) continue;
    slices.push({ id: `slice_${slices.length + 1}`, start, end, duration: end - start });
  }
  return slices;
}

export function mapNoteEventsToPianoRoll(analysis, { ppq = 480, bpm = null } = {}) {
  const events = analysis?.music?.noteEvents || analysis?.noteEvents || [];
  const resolvedBpm = Number(bpm ?? analysis?.music?.bpm);
  if (!Number.isFinite(resolvedBpm) || resolvedBpm <= 0) throw new Error('valid BPM is required to map seconds to ticks');
  const ticksPerSecond = ppq * resolvedBpm / 60;
  return events.filter((event)=>Number.isFinite(event?.midi) && Number.isFinite(event?.start) && Number.isFinite(event?.end)).map((event,index)=>({
    id: `note_${index + 1}`,
    midi: Math.round(event.midi),
    startTick: Math.round(event.start * ticksPerSecond),
    durationTicks: Math.max(1, Math.round((event.end - event.start) * ticksPerSecond)),
    velocity: confidenceToVelocity(event.confidence),
    confidence: Number(event.confidence ?? 0)
  }));
}

export function createChromaticInstrumentDescriptor(analysis, { preserveFormants = true, confidenceThreshold = 0.65 } = {}) {
  const voice = analysis?.voice || {};
  const pitchHz = Number(voice.pitchHz);
  const pitchConfidence = Number(voice.pitchConfidence ?? analysis?.confidence?.pitch ?? 0);
  if (!Number.isFinite(pitchHz) || pitchHz <= 0) return { ready: false, reason: 'pitch_unavailable', confidence: pitchConfidence };
  if (pitchConfidence < confidenceThreshold) return { ready: false, reason: 'low_pitch_confidence', confidence: pitchConfidence };
  const midi = 69 + 12 * Math.log2(pitchHz / 440);
  return {
    ready: true,
    rootHz: pitchHz,
    rootMidi: Math.round(midi),
    detuneCents: (midi - Math.round(midi)) * 100,
    preserveFormants: Boolean(preserveFormants && (voice.formants?.length || voice.spectralEnvelope)),
    formants: voice.formants || [],
    confidence: pitchConfidence
  };
}

export function buildAudioToInstrumentPlan(analysis, options = {}) {
  return {
    slices: createSlicesFromAnalysis(analysis, options),
    pianoRoll: Number(analysis?.music?.bpm) > 0 ? mapNoteEventsToPianoRoll(analysis, options) : [],
    chromatic: createChromaticInstrumentDescriptor(analysis, options),
    sourceAssetId: analysis?.assetId || null,
    analysisSchemaVersion: analysis?.schemaVersion || null
  };
}

function confidenceToVelocity(confidence) {
  const value = Number(confidence);
  if (!Number.isFinite(value)) return 96;
  return Math.max(1, Math.min(127, Math.round(48 + value * 79)));
}
