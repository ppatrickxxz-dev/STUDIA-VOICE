import { normalizeArrangementMap, normalizeSectionKind } from '../../core/src/section-map.mjs';

export const PROJECT_MUSIC_GRAPH_SCHEMA = 'pablovoice_project_music_graph_v1';

export function buildProjectMusicGraph(project = {}, {
  pendingDraft = null,
  pmiSession = null,
  mixState = null,
  evidenceByTrack = null,
} = {}) {
  if (!project || typeof project !== 'object') throw new TypeError('project_required');

  const tracks = normalizeTracks(project.tracks, project.activeTrackId);
  const durationSeconds = maxDuration(tracks);
  const sections = normalizeSections(project.arrangementMap, durationSeconds);
  const songCreation = normalizeSongCreation(project.songCreation);
  const latestTake = songCreation.latestTakeId
    ? songCreation.takes.find((take) => take.id === songCreation.latestTakeId) || null
    : songCreation.takes.at(-1) || null;

  const graph = {
    schema: PROJECT_MUSIC_GRAPH_SCHEMA,
    source: Object.freeze({
      projectSchemaVersion: finite(project.schemaVersion),
      appVersion: bounded(project.appVersion, 48) || null,
      derived: true,
      persistedSeparately: false,
    }),
    project: Object.freeze({
      id: bounded(project.id, 180) || null,
      name: bounded(project.name, 120) || 'Projeto PabloVoice',
      preset: bounded(project.preset, 32) || null,
      createdAt: finite(project.createdAt),
      updatedAt: finite(project.updatedAt),
      activeTrackId: bounded(project.activeTrackId, 180) || null,
      revisionCount: Array.isArray(project.revisions) ? project.revisions.length : 0,
    }),
    structure: Object.freeze({
      durationSeconds,
      arrangementSchema: bounded(project.arrangementMap?.schema, 96) || null,
      sections: Object.freeze(sections),
    }),
    writing: Object.freeze({
      lyrics: bounded(project.lyrics, 16000),
      notes: bounded(project.notes, 6000),
      authorialMemory: freezeClone(project.authorialMemory),
      pendingDraft: normalizePendingDraft(pendingDraft),
      pmiSession: freezeClone(pmiSession),
    }),
    tracks: Object.freeze(tracks.map((track) => Object.freeze({
      ...track,
      sectionIds: Object.freeze(sectionIdsForTrack(track, sections)),
    }))),
    labs: Object.freeze({
      beat: freezeClone(project.beatLab),
      instrument: freezeClone(project.instrumentLab),
    }),
    songCreation: Object.freeze({
      schema: songCreation.schema,
      latestTakeId: songCreation.latestTakeId,
      takeCount: songCreation.takes.length,
      latestTake: freezeClone(latestTake),
      lineage: Object.freeze(songCreation.lineage),
    }),
    mix: normalizeMixState(mixState),
    evidence: normalizeEvidenceByTrack(evidenceByTrack, tracks),
  };

  return Object.freeze(graph);
}

export function musicGraphContextPack(graph = {}) {
  if (graph?.schema !== PROJECT_MUSIC_GRAPH_SCHEMA) throw new TypeError('project_music_graph_required');
  const latest = graph.songCreation?.latestTake || null;
  return Object.freeze({
    source: 'pablovoice-project-music-graph',
    graph_schema: graph.schema,
    project: Object.freeze({
      local_id: graph.project?.id || null,
      title: graph.project?.name || 'Projeto PabloVoice',
      preset: graph.project?.preset || null,
      track_count: graph.tracks?.length || 0,
      active_track_id: graph.project?.activeTrackId || null,
      duration_seconds: graph.structure?.durationSeconds || 0,
      revision_count: graph.project?.revisionCount || 0,
      lyrics: bounded(graph.writing?.lyrics, 12000),
      notes: bounded(graph.writing?.notes, 4000),
    }),
    structure: Object.freeze({
      sections: Object.freeze((graph.structure?.sections || []).map((section) => Object.freeze({
        id: section.id,
        kind: section.kind,
        label: section.label,
        start_seconds: section.startSeconds,
        end_seconds: section.endSeconds,
        confirmed: section.timingStatus === 'confirmed',
        confidence: section.confidence,
      }))),
    }),
    tracks: Object.freeze((graph.tracks || []).slice(0, 24).map((track) => Object.freeze({
      id: track.id,
      name: track.name,
      kind: track.kind,
      role: track.role,
      asset_id: track.assetId,
      duration: track.duration,
      offset: track.offset,
      trim_start: track.trimStart,
      trim_end: track.trimEnd,
      gain: track.gain,
      pan: track.pan,
      muted: track.muted,
      solo: track.solo,
      active: track.active,
      section_ids: track.sectionIds,
      effects: track.effects,
      automation_count: track.automationCount,
      song_take_id: track.songTakeId,
      source: track.source,
      provenance: summarizeTrackProvenance(track),
    }))),
    labs: Object.freeze({
      beat: summarizeBeatLab(graph.labs?.beat),
      instrument: summarizeInstrumentLab(graph.labs?.instrument),
    }),
    song_creation: Object.freeze({
      latest_take_id: graph.songCreation?.latestTakeId || null,
      take_count: graph.songCreation?.takeCount || 0,
      brief: bounded(latest?.brief, 1200),
      genre: bounded(latest?.genre, 120),
      mood: bounded(latest?.mood, 120),
      bpm: finite(latest?.bpm),
      key: bounded(latest?.key, 16),
      mode: bounded(latest?.mode, 16),
      lineage: Object.freeze((graph.songCreation?.lineage || []).slice(-24).map((take) => Object.freeze({ ...take }))),
    }),
    pmi: Object.freeze({
      pending_draft: graph.writing?.pendingDraft ? {
        version: graph.writing.pendingDraft.version,
        command: graph.writing.pendingDraft.command,
        target_section: graph.writing.pendingDraft.targetSection,
        target_genre: graph.writing.pendingDraft.targetGenre,
      } : null,
      authorial_memory: graph.writing?.authorialMemory || null,
    }),
    mix: graph.mix,
    evidence: summarizeEvidencePack(graph.evidence),
  });
}

export function resolveMusicGraphScope(graph = {}, {
  trackId = null,
  assetId = null,
  target = null,
  section = null,
  occurrence = 1,
} = {}) {
  if (graph?.schema !== PROJECT_MUSIC_GRAPH_SCHEMA) throw new TypeError('project_music_graph_required');
  const tracks = graph.tracks || [];
  const sections = graph.structure?.sections || [];
  const normalizedTarget = normalizeToken(target);
  const requestedTrackId = String(trackId || '');
  const requestedAssetId = String(assetId || '');
  const track = tracks.find((item) => requestedTrackId && item.id === requestedTrackId)
    || tracks.find((item) => requestedAssetId && item.assetId === requestedAssetId)
    || tracks.find((item) => normalizedTarget && [item.role, item.kind, item.name].some((value) => normalizeToken(value).includes(normalizedTarget)))
    || null;

  const normalizedSection = normalizeSectionKind(section) || normalizeToken(section);
  const matches = sections.filter((item) => item.kind === normalizedSection || normalizeToken(item.label) === normalizedSection);
  const index = Math.max(0, Math.floor(Number(occurrence) || 1) - 1);
  const resolvedSection = matches[index] || null;

  return Object.freeze({
    track: track ? Object.freeze({ ...track }) : null,
    section: resolvedSection ? Object.freeze({ ...resolvedSection }) : null,
    evidence: track ? graph.evidence?.tracks?.find((item) => item.trackId === track.id) || null : null,
    preserveUnselected: true,
  });
}

export function validateMusicGraphAssets(graph = {}, assetIds = []) {
  if (graph?.schema !== PROJECT_MUSIC_GRAPH_SCHEMA) return Object.freeze({ ok: false, reason: 'project_music_graph_required' });
  const requested = [...new Set((Array.isArray(assetIds) ? assetIds : [assetIds]).map(String).filter(Boolean))];
  const owned = new Set((graph.tracks || []).map((track) => String(track.assetId || '')).filter(Boolean));
  const missing = requested.filter((assetId) => !owned.has(assetId));
  return Object.freeze({ ok: missing.length === 0, reason: missing.length ? 'asset_outside_music_graph' : null, missing: Object.freeze(missing) });
}

function normalizeTracks(input, activeTrackId) {
  if (!Array.isArray(input)) return [];
  return input.filter(Boolean).slice(0, 64).map((track) => {
    const duration = nonNegative(track.duration);
    const trimStart = clamp(nonNegative(track.trimStart), 0, duration || Number.MAX_SAFE_INTEGER);
    const trimEnd = clamp(finite(track.trimEnd) ?? duration, trimStart, duration || Number.MAX_SAFE_INTEGER);
    return Object.freeze({
      id: bounded(track.id, 180) || null,
      assetId: bounded(track.assetId || track.audioId, 180) || null,
      name: bounded(track.name, 160) || 'Faixa',
      kind: bounded(track.kind, 64) || 'audio',
      role: deriveTrackRole(track),
      type: bounded(track.type, 96) || null,
      duration,
      sampleRate: finite(track.sampleRate),
      channels: finite(track.channels),
      offset: nonNegative(track.offset),
      trimStart,
      trimEnd,
      gain: finite(track.gain) ?? 1,
      pan: finite(track.pan) ?? 0,
      muted: Boolean(track.muted),
      solo: Boolean(track.solo),
      active: String(track.id || '') === String(activeTrackId || ''),
      effects: freezeClone(track.effects) || Object.freeze({}),
      automationCount: Array.isArray(track.regionAutomation) ? track.regionAutomation.length : 0,
      regionAutomation: freezeArray(track.regionAutomation, 96),
      songTakeId: bounded(track.songTakeId, 180) || null,
      source: bounded(track.source, 120) || null,
      provider: bounded(track.provider, 120) || null,
      providerModel: bounded(track.providerModel || track.model, 160) || null,
      remoteSha256: bounded(track.remoteSha256, 96) || null,
      stemType: bounded(track.stemType, 48) || null,
      renderJobId: bounded(track.renderJobId, 180) || null,
      remoteAssetId: bounded(track.remoteAssetId, 180) || null,
      remoteProjectId: bounded(track.remoteProjectId, 180) || null,
      engine: bounded(track.engine, 120) || null,
      derivedFromTakeId: bounded(track.derivedFromTakeId, 180) || null,
    });
  });
}

function normalizeSections(arrangementMap, durationSeconds) {
  const normalized = normalizeArrangementMap(arrangementMap || {});
  return normalized.sections.map((section, index, all) => {
    const inferredEnd = all[index + 1]?.startSeconds ?? durationSeconds ?? null;
    const endSeconds = section.endSeconds ?? (inferredEnd > section.startSeconds ? inferredEnd : null);
    return Object.freeze({
      id: section.id,
      kind: section.kind,
      label: section.label,
      startSeconds: section.startSeconds,
      endSeconds,
      source: section.source,
      timingStatus: section.timingStatus,
      confidence: section.confidence,
    });
  });
}

function normalizeSongCreation(value = {}) {
  const takes = Array.isArray(value?.takes) ? value.takes.slice(-24).map((take) => freezeClone(take)).filter(Boolean) : [];
  const lineage = takes.map((take) => Object.freeze({
    id: bounded(take?.id, 180) || null,
    parentTakeId: bounded(take?.derivedFromTakeId, 180) || null,
    referenceTrackId: bounded(take?.referenceTrackId, 180) || null,
    providerSongId: bounded(take?.providerSongId, 180) || null,
    provider: bounded(take?.provider, 120) || null,
    model: bounded(take?.model, 160) || null,
    durationSeconds: finite(take?.durationSeconds),
    createdAt: finite(take?.createdAt ?? take?.at),
  }));
  return {
    schema: bounded(value?.schema, 96) || null,
    latestTakeId: bounded(value?.latestTakeId, 180) || null,
    takes,
    lineage,
  };
}

function normalizePendingDraft(value) {
  if (!value || typeof value !== 'object') return null;
  const text = bounded(value.text, 12000);
  if (!text) return null;
  return Object.freeze({
    text,
    version: finite(value.version),
    command: bounded(value.command, 64) || null,
    targetSection: bounded(value.targetSection, 64) || null,
    targetGenre: bounded(value.targetGenre, 64) || null,
  });
}

function normalizeMixState(value) {
  if (!value || typeof value !== 'object') return null;
  return freezeClone({
    schemaVersion: value.schemaVersion ?? null,
    foreground: Array.isArray(value.foreground) ? value.foreground.slice(0, 16) : [],
    confidence: finite(value.confidence),
    relations: Array.isArray(value.relations) ? value.relations.slice(0, 96) : [],
  });
}

function normalizeEvidenceByTrack(value, tracks) {
  if (!value) return Object.freeze({ schema: 'pablovoice_music_graph_evidence_v1', tracks: Object.freeze([]) });
  const entries = value instanceof Map ? [...value.entries()] : Object.entries(value || {});
  const trackByAsset = new Map(tracks.map((track) => [String(track.assetId || ''), track]).filter(([assetId]) => assetId));
  const trackById = new Map(tracks.map((track) => [String(track.id || ''), track]).filter(([trackId]) => trackId));
  const normalized = [];
  for (const [key, analysis] of entries.slice(0, 64)) {
    if (!analysis || typeof analysis !== 'object') continue;
    const track = trackById.get(String(key)) || trackByAsset.get(String(key)) || trackByAsset.get(String(analysis.assetId || '')) || null;
    if (!track) continue;
    normalized.push(Object.freeze({
      trackId: track.id,
      assetId: track.assetId,
      analysisSchemaVersion: finite(analysis.schemaVersion ?? analysis.analysisV2?.schemaVersion),
      validityComplete: analysis.validity?.complete === true,
      confidence: freezeClone(analysis.confidence) || null,
      music: freezeClone(analysis.music) || null,
      voice: freezeClone(analysis.voice) || null,
      signal: Object.freeze({
        loudnessLufs: featureNumber(analysis.signal?.loudnessLufs),
        peak: featureNumber(analysis.signal?.peak),
        clipping: featureNumber(analysis.signal?.clipping),
        onsetCount: Array.isArray(analysis.signal?.onsets) ? analysis.signal.onsets.length : null,
      }),
    }));
  }
  return Object.freeze({ schema: 'pablovoice_music_graph_evidence_v1', tracks: Object.freeze(normalized) });
}

function sectionIdsForTrack(track, sections) {
  const start = track.offset + track.trimStart;
  const end = track.offset + Math.max(track.trimStart, track.trimEnd || track.duration);
  return sections.filter((section) => {
    const sectionEnd = section.endSeconds ?? Number.POSITIVE_INFINITY;
    return end > section.startSeconds && start < sectionEnd;
  }).map((section) => section.id);
}

function summarizeBeatLab(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({
    bpm: finite(value.bpm),
    bars: finite(value.bars),
    swing: finite(value.swing),
    step_count: Array.isArray(value.steps) ? value.steps.length : null,
    pad_count: Array.isArray(value.pads) ? value.pads.length : null,
  });
}

function summarizeInstrumentLab(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({
    preset: bounded(value.preset, 96) || null,
    bpm: finite(value.bpm),
    note_count: Array.isArray(value.notes) ? value.notes.length : 0,
  });
}

function summarizeTrackProvenance(track) {
  const hasRemote = Boolean(track.remoteAssetId || track.renderJobId || track.remoteSha256);
  const hasTake = Boolean(track.songTakeId || track.derivedFromTakeId);
  if (!hasRemote && !hasTake && !track.provider && !track.engine) return null;
  return Object.freeze({
    stem_type: track.stemType || null,
    render_job_id: track.renderJobId || null,
    remote_asset_id: track.remoteAssetId || null,
    remote_project_id: track.remoteProjectId || null,
    sha256: track.remoteSha256 || null,
    provider: track.provider || null,
    engine: track.engine || null,
    model: track.providerModel || null,
    song_take_id: track.songTakeId || null,
    derived_from_take_id: track.derivedFromTakeId || null,
  });
}

function summarizeEvidencePack(value) {
  if (!value || !Array.isArray(value.tracks)) return null;
  return Object.freeze({
    schema: value.schema || null,
    tracks: Object.freeze(value.tracks.slice(0, 24).map((item) => Object.freeze({
      track_id: item.trackId,
      asset_id: item.assetId,
      validity_complete: item.validityComplete,
      confidence: item.confidence,
      music: item.music,
      voice: item.voice,
      signal: item.signal,
    }))),
  });
}

function deriveTrackRole(track) {
  const explicit = bounded(track.role, 96);
  if (explicit) return explicit;
  const stemType = normalizeToken(track.stemType);
  if (stemType === 'vocal') return 'stem-vocal';
  if (stemType === 'instrumental') return 'stem-instrumental';
  const kind = normalizeToken(track.kind);
  const name = normalizeToken(track.name);
  if (kind.includes('voice variant') || kind.includes('voice_variant')) return 'voice-variant';
  if (kind.includes('recording') || name.includes('vocal') || name.includes('voz')) return 'lead-vocal';
  if (kind.includes('guide')) return 'guide-vocal-target';
  if (kind.includes('harmony') || name.includes('harmonia') || name.includes('backing')) return 'harmony-vocal';
  if (kind.includes('instrumental')) return 'instrumental';
  if (kind.includes('stem')) return 'stem';
  return 'unknown';
}

function maxDuration(tracks) {
  let max = 0;
  for (const track of tracks) max = Math.max(max, track.offset + Math.max(track.duration, track.trimEnd || 0));
  return max;
}

function freezeClone(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  return deepFreeze(structuredClone(value));
}

function freezeArray(value, limit = 64) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.slice(0, limit).map((item) => freezeClone(item)));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function normalizeToken(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function bounded(value, limit) {
  return String(value ?? '').trim().slice(0, limit);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function featureNumber(value) {
  return finite(value?.value ?? value);
}

function nonNegative(value) {
  return Math.max(0, finite(value) ?? 0);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
