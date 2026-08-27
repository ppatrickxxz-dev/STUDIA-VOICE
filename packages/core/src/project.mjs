export const PROJECT_SCHEMA_VERSION = 5;

export const DEFAULT_EFFECTS = Object.freeze({
  clean: true,
  warm: false,
  presence: false,
  normalize: true,
  compressor: true,
  deEsser: false,
  saturation: 0,
  lowEq: 0,
  midEq: 0,
  highEq: 0,
  pitchSemitones: 0,
  double: false,
  fadeIn: 0,
  fadeOut: 0,
});

export function createId(prefix = 'pv') {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`;
}

export function createProject(name = 'Minha ideia', now = Date.now()) {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: createId('project'),
    name: String(name || 'Minha ideia').trim().slice(0, 80),
    createdAt: now,
    updatedAt: now,
    activeTrackId: null,
    tracks: [],
    lyrics: '',
    notes: '',
    preset: 'demo',
    authorialMemory: null,
    revisions: [],
    appVersion: '2.4.0-rc.1',
  };
}

export function createTrack({ name, assetId, type = 'audio/wav', duration = 0, sampleRate = 0, channels = 1, kind = 'audio' }) {
  const now = Date.now();
  return {
    id: createId('track'),
    assetId,
    name: String(name || 'Faixa').slice(0, 120),
    type,
    kind,
    createdAt: now,
    updatedAt: now,
    duration: finite(duration, 0),
    sampleRate: finite(sampleRate, 0),
    channels: Math.max(1, Math.min(2, finite(channels, 1))),
    offset: 0,
    trimStart: 0,
    trimEnd: finite(duration, 0),
    gain: 1,
    pan: 0,
    muted: false,
    solo: false,
    effects: { ...DEFAULT_EFFECTS },
    regionAutomation: [],
  };
}

export function migrateProject(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Projeto inválido.');
  const now = Date.now();
  const project = { ...createProject(input.name || input.title || 'Minha ideia', input.createdAt || now), ...structuredClone(input) };
  project.schemaVersion = PROJECT_SCHEMA_VERSION;
  project.name = String(project.name || 'Minha ideia').slice(0, 80);
  project.createdAt = finite(project.createdAt, now);
  project.updatedAt = finite(project.updatedAt, project.createdAt);
  project.tracks = Array.isArray(project.tracks) ? project.tracks.map(migrateTrack) : [];
  project.activeTrackId = project.tracks.some((track) => track.id === project.activeTrackId)
    ? project.activeTrackId
    : project.tracks[0]?.id || null;
  project.revisions = Array.isArray(project.revisions) ? project.revisions.slice(-40) : [];
  project.lyrics = String(project.lyrics || '');
  project.notes = String(project.notes || '');
  project.preset = ['music', 'demo', 'podcast', 'video', 'streaming'].includes(project.preset) ? project.preset : 'demo';
  project.authorialMemory = normalizeAuthorialMemory(project.authorialMemory);
  return project;
}

export function migrateTrack(input) {
  const duration = finite(input?.duration, 0);
  return {
    ...createTrack({
      name: input?.name,
      assetId: input?.assetId || input?.audioId,
      type: input?.type,
      duration,
      sampleRate: input?.sampleRate,
      channels: input?.channels,
      kind: input?.kind,
    }),
    ...structuredClone(input || {}),
    duration,
    offset: Math.max(0, finite(input?.offset, 0)),
    trimStart: clamp(finite(input?.trimStart, 0), 0, duration),
    trimEnd: clamp(finite(input?.trimEnd, duration), 0, duration),
    gain: clamp(finite(input?.gain, 1), 0, 2),
    pan: clamp(finite(input?.pan, 0), -1, 1),
    muted: Boolean(input?.muted),
    solo: Boolean(input?.solo),
    effects: { ...DEFAULT_EFFECTS, ...(input?.effects || {}) },
    regionAutomation: normalizeRegionAutomation(input?.regionAutomation, duration),
  };
}

export function snapshotProject(project, label = 'Salvamento') {
  const clean = migrateProject(project);
  const revision = {
    id: createId('revision'),
    at: Date.now(),
    label: String(label).slice(0, 80),
    tracks: clean.tracks.map(({ id, name, trimStart, trimEnd, gain, pan, muted, solo, effects, regionAutomation }) => ({
      id, name, trimStart, trimEnd, gain, pan, muted, solo, effects: { ...effects }, regionAutomation: structuredClone(regionAutomation),
    })),
    lyrics: clean.lyrics,
    preset: clean.preset,
    authorialMemory: clean.authorialMemory ? structuredClone(clean.authorialMemory) : null,
  };
  clean.revisions = [...clean.revisions, revision].slice(-40);
  clean.updatedAt = revision.at;
  return clean;
}

export function validateProject(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return { valid: false, errors: ['Projeto ausente.'] };
  if (!input.id) errors.push('ID do projeto ausente.');
  if (!input.name) errors.push('Nome do projeto ausente.');
  if (!Array.isArray(input.tracks)) errors.push('Tracks inválidas.');
  if (input.authorialMemory != null && typeof input.authorialMemory !== 'object') errors.push('Memória autoral inválida.');
  for (const track of input.tracks || []) {
    if (!track.id || !track.assetId) errors.push('Track sem ID ou arquivo.');
    if (finite(track.trimStart, 0) > finite(track.trimEnd, 0)) errors.push(`Trim invertido em ${track.name || track.id}.`);
  }
  return { valid: errors.length === 0, errors };
}

function normalizeAuthorialMemory(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const memory = {
    schema: 'pmi_authorial_memory_v1',
    vocabulary: boundedStrings(input.vocabulary),
    preferredStructures: boundedStrings(input.preferredStructures),
    preferredImages: boundedStrings(input.preferredImages),
    avoid: boundedStrings(input.avoid),
    acceptedPatterns: boundedStrings(input.acceptedPatterns),
    rejectedPatterns: boundedStrings(input.rejectedPatterns),
    evidenceCount: clamp(Math.floor(finite(input.evidenceCount, 0)), 0, 10000),
  };
  const lastReason = String(input.lastReason || '').trim().slice(0, 300);
  if (lastReason) memory.lastReason = lastReason;
  return memory;
}

function boundedStrings(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => String(value || '').trim().slice(0, 160)).filter(Boolean))].slice(0, 80);
}

function normalizeRegionAutomation(input, duration) {
  if (!Array.isArray(input)) return [];
  return input.map((event, index) => {
    const start = clamp(finite(event?.startSeconds ?? event?.start, 0), 0, duration);
    const end = clamp(finite(event?.endSeconds ?? event?.end, start), start, duration);
    return {
      id: String(event?.id || `region_${index}`),
      kind: String(event?.kind || 'gain'),
      startSeconds: start,
      endSeconds: end,
      gainDb: clamp(finite(event?.gainDb ?? event?.reductionDb, 0), -60, 12),
      confidence: clamp(finite(event?.confidence, 0), 0, 1),
      source: String(event?.source || 'manual'),
      enabled: event?.enabled !== false,
    };
  }).filter((event) => event.endSeconds > event.startSeconds);
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
