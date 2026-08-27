export const ANALYSIS_SCHEMA_VERSION = 2;

export function createFeatureState({ value = null, confidence = null, valid = true, measuredAt = null, provenance = {} } = {}) {
  return { value, confidence, valid, measuredAt, provenance };
}

export function createAnalysisRecordV2({ assetId, sourceVersion = 1, sampleRate = null, channels = null, durationSeconds = null, provenance = {} } = {}) {
  if (!assetId) throw new Error('assetId is required');
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    assetId,
    sourceVersion,
    measuredAt: new Date().toISOString(),
    source: { sampleRate, channels, durationSeconds },
    music: { bpm: createFeatureState(), tempoMap: [], beats: [], downbeats: [], key: createFeatureState(), scale: createFeatureState(), sections: [], noteEvents: [] },
    signal: { peak: createFeatureState(), truePeak: createFeatureState(), rms: createFeatureState(), loudnessLufs: createFeatureState(), dynamicRangeDb: createFeatureState(), silenceRatio: createFeatureState(), clippingRatio: createFeatureState(), onsets: [], transients: [], spectralEnvelope: [], phaseCorrelation: createFeatureState() },
    voice: { pitchHz: createFeatureState(), pitchContour: [], rangeHz: createFeatureState(), pitchStability: createFeatureState(), voicedRegions: [], unvoicedRegions: [], formants: [], snrDb: createFeatureState(), sibilance: createFeatureState(), roomReverb: createFeatureState(), breathEvents: [] },
    segments: [],
    provenance,
    validity: { complete: false, invalidatedRanges: [] }
  };
}

export function invalidateRange(record, { startSeconds, endSeconds, features = ['*'], reason = 'edit' } = {}) {
  if (!record?.validity) throw new Error('record validity state is required');
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) throw new Error('invalid range');
  record.validity.complete = false;
  record.validity.invalidatedRanges.push({ startSeconds, endSeconds, features: [...features], reason });
  return record;
}

export function clearInvalidatedRanges(record) {
  if (!record?.validity) throw new Error('record validity state is required');
  record.validity.invalidatedRanges = [];
  record.validity.complete = true;
  return record;
}
