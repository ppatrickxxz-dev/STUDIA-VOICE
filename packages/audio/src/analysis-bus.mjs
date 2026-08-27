export const ANALYSIS_SCHEMA_VERSION = 1;

export function createAnalysisRecord({ assetId, sourceVersion = 1, sampleRate, channels, durationSeconds, provenance = {} } = {}) {
  if (!assetId) throw new Error('assetId is required');
  return {
    schemaVersion: ANALYSIS_SCHEMA_VERSION,
    assetId,
    sourceVersion,
    measuredAt: new Date().toISOString(),
    source: {
      sampleRate: finiteOrNull(sampleRate),
      channels: finiteOrNull(channels),
      durationSeconds: finiteOrNull(durationSeconds)
    },
    music: {
      bpm: null,
      bpmConfidence: null,
      beats: [],
      downbeats: [],
      key: null,
      keyConfidence: null,
      sections: []
    },
    signal: {
      peak: null,
      truePeak: null,
      rms: null,
      loudnessLufs: null,
      dynamicRangeDb: null,
      silenceRatio: null,
      clippingRatio: null,
      onsets: [],
      transients: []
    },
    voice: {
      pitchHz: null,
      pitchContour: [],
      pitchConfidence: null,
      rangeHz: null,
      pitchStability: null,
      snrDb: null,
      sibilance: null,
      roomReverb: null,
      breathEvents: []
    },
    provenance: normalizeProvenance(provenance)
  };
}

export function mergeAnalysis(base, patch, provenance = {}) {
  if (!base?.assetId) throw new Error('base analysis record is required');
  const next = structuredClone(base);
  deepMergeKnown(next, patch || {});
  next.measuredAt = new Date().toISOString();
  next.provenance = mergeProvenance(next.provenance, provenance);
  return next;
}

export function analysisCacheKey({ assetId, sourceVersion = 1, recipeVersion = 'default' } = {}) {
  if (!assetId) throw new Error('assetId is required');
  return `${assetId}:v${sourceVersion}:${recipeVersion}`;
}

export class AudioAnalysisBus {
  constructor({ load = async () => null, save = async () => {} } = {}) {
    this.load = load;
    this.save = save;
    this.cache = new Map();
    this.subscribers = new Map();
  }

  async get(key) {
    if (this.cache.has(key)) return this.cache.get(key);
    const persisted = await this.load(key);
    if (persisted) this.cache.set(key, persisted);
    return persisted || null;
  }

  async put(key, record) {
    validateAnalysisRecord(record);
    this.cache.set(key, record);
    await this.save(key, record);
    this.emit(key, record);
    return record;
  }

  subscribe(key, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    const set = this.subscribers.get(key) || new Set();
    set.add(listener);
    this.subscribers.set(key, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.subscribers.delete(key);
    };
  }

  emit(key, record) {
    for (const listener of this.subscribers.get(key) || []) listener(record);
  }
}

export function validateAnalysisRecord(record) {
  if (!record || record.schemaVersion !== ANALYSIS_SCHEMA_VERSION) throw new Error('unsupported analysis schema');
  if (!record.assetId) throw new Error('analysis assetId is required');
  if (!record.music || !record.signal || !record.voice || !record.provenance) throw new Error('analysis record is incomplete');
  return true;
}

function deepMergeKnown(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in target) || value === undefined) continue;
    if (isObject(target[key]) && isObject(value)) deepMergeKnown(target[key], value);
    else target[key] = structuredClone(value);
  }
}

function mergeProvenance(base = {}, patch = {}) {
  return { ...normalizeProvenance(base), ...normalizeProvenance(patch) };
}

function normalizeProvenance(value = {}) {
  return {
    analyzer: value.analyzer || null,
    analyzerVersion: value.analyzerVersion || null,
    model: value.model || null,
    modelVersion: value.modelVersion || null,
    recipeVersion: value.recipeVersion || null,
    measured: value.measured === true
  };
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteOrNull(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}
