export const PABLOVOICE_SONG_MODEL_SCHEMA = 'pablovoice_song_model_v3';
export const PABLOVOICE_VOCAL_PERFORMANCE_SCHEMA = 'pablovoice_vocal_performance_v1';
export const PABLOVOICE_VOICE_RENDER_SCHEMA = 'pablovoice_voice_render_v1';
export const PABLOVOICE_MIX_SCHEMA = 'pablovoice_mix_v1';

export const VOICE_REPLACEMENT_LOCK = Object.freeze({
  schema: 'pablovoice_voice_replacement_lock_v1',
  mode: 'identity_only',
  immutable: Object.freeze([
    'lyrics',
    'phonemes',
    'vocalMelody',
    'notes',
    'pitchContour',
    'timing',
    'durations',
    'phrasing',
    'dynamics',
    'breathPlacement',
    'vibratoIntent',
    'harmonies',
    'adlibs',
    'songStructure',
    'bpm',
    'key',
    'instrumental',
    'arrangement',
    'songDuration',
  ]),
  mutable: Object.freeze([
    'voiceIdentity',
    'timbre',
    'resonance',
    'formants',
    'vocalTexture',
    'breathCharacter',
    'registerCharacter',
  ]),
  onViolation: 'reject_render',
});

export function ensureSongModelV3(project) {
  if (!project || typeof project !== 'object') return project;
  const take = latestSongTake(project);
  const previous = project.songModel?.schema === PABLOVOICE_SONG_MODEL_SCHEMA ? project.songModel : {};
  const instrumental = isInstrumentalTake(take);
  const nativePerformance = resolveNativePerformance(take, previous.vocalPerformance);
  const referenceTrackId = take?.referenceTrackId || take?.instrumentalTrackId || previous.mix?.masterTrackId || project.activeTrackId || null;
  const guideTrackId = take?.guideTrackId || previous.vocalPerformance?.guideTrackId || null;
  const lyrics = String(project.lyrics ?? take?.lyricsSnapshot ?? previous.composition?.lyrics ?? '');

  project.songModel = {
    ...previous,
    schema: PABLOVOICE_SONG_MODEL_SCHEMA,
    updatedAt: Date.now(),
    sourceTakeId: take?.id || previous.sourceTakeId || null,
    composition: {
      ...(previous.composition || {}),
      schema: 'pablovoice_composition_v1',
      sourceTakeId: take?.id || previous.composition?.sourceTakeId || null,
      lyrics,
      bpm: finiteOrNull(take?.bpm ?? previous.composition?.bpm),
      key: take?.key ?? previous.composition?.key ?? null,
      genre: take?.genre ?? previous.composition?.genre ?? null,
      mood: take?.mood ?? previous.composition?.mood ?? null,
      durationSeconds: finiteOrNull(take?.durationSeconds ?? previous.composition?.durationSeconds),
      sections: copyArray(take?.sections ?? previous.composition?.sections),
      arrangementMap: project.arrangementMap || previous.composition?.arrangementMap || null,
      status: take ? 'ready' : (previous.composition?.status || 'draft'),
    },
    vocalPerformance: {
      ...(previous.vocalPerformance || {}),
      schema: PABLOVOICE_VOCAL_PERFORMANCE_SCHEMA,
      sourceTakeId: take?.id || previous.vocalPerformance?.sourceTakeId || null,
      guideTrackId,
      status: instrumental ? 'not_required' : nativePerformance ? 'ready' : (take ? 'capture_required' : 'not_created'),
      authority: instrumental
        ? 'instrumental_only'
        : nativePerformance
          ? 'master_vocal_performance'
          : 'legacy_guide_not_authoritative',
      source: nativePerformance?.source || (take?.guideType === 'synth_melody' ? 'legacy_synth_guide' : previous.vocalPerformance?.source || null),
      performance: nativePerformance?.performance || previous.vocalPerformance?.performance || null,
      lyrics,
      sections: copyArray(take?.sections ?? previous.vocalPerformance?.sections),
      preservationRequired: !instrumental,
    },
    voice: {
      ...(previous.voice || {}),
      schema: PABLOVOICE_VOICE_RENDER_SCHEMA,
      activeProfileId: previous.voice?.activeProfileId || 'guide',
      guideProfile: {
        id: 'guide',
        label: 'Voz guia',
        authorized: true,
        kind: 'guide',
        ...(previous.voice?.guideProfile || {}),
      },
      personalProfile: previous.voice?.personalProfile || null,
      replacementLock: VOICE_REPLACEMENT_LOCK,
      replacementStatus: instrumental
        ? 'not_applicable'
        : nativePerformance
          ? (previous.voice?.personalProfile ? 'ready' : 'needs_personal_voice')
          : 'needs_master_vocal_performance',
    },
    mix: {
      ...(previous.mix || {}),
      schema: PABLOVOICE_MIX_SCHEMA,
      masterTrackId: referenceTrackId,
      trackIds: (project.tracks || []).map((track) => track.id).filter(Boolean),
      stemTrackIds: (project.tracks || []).filter(isStemTrack).map((track) => track.id),
      status: referenceTrackId ? 'ready' : (previous.mix?.status || 'draft'),
      sourceTakeId: take?.id || previous.mix?.sourceTakeId || null,
    },
  };

  return project;
}

export function songModelReadiness(project) {
  const normalized = ensureSongModelV3(project);
  const model = normalized?.songModel;
  if (!model) return {
    compositionReady: false,
    vocalPerformanceReady: false,
    voiceReplacementReady: false,
    mixReady: false,
    firstSongReady: false,
  };
  const instrumental = model.vocalPerformance?.status === 'not_required';
  const compositionReady = model.composition?.status === 'ready';
  const vocalPerformanceReady = instrumental || model.vocalPerformance?.status === 'ready';
  const voiceReplacementReady = !instrumental && model.vocalPerformance?.status === 'ready' && Boolean(model.voice?.personalProfile?.authorized);
  const mixReady = model.mix?.status === 'ready' && Boolean(model.mix?.masterTrackId);
  return {
    compositionReady,
    vocalPerformanceReady,
    voiceReplacementReady,
    mixReady,
    // A finished guide-voice song must be usable before My Voice is ready.
    firstSongReady: compositionReady && mixReady,
  };
}

export function attachMasterVocalPerformance(project, {
  sourceTakeId = null,
  guideTrackId = null,
  source = 'native_sung_performance',
  performance = null,
} = {}) {
  ensureSongModelV3(project);
  project.songModel.vocalPerformance = {
    ...project.songModel.vocalPerformance,
    schema: PABLOVOICE_VOCAL_PERFORMANCE_SCHEMA,
    sourceTakeId: sourceTakeId || project.songModel.sourceTakeId || null,
    guideTrackId: guideTrackId || project.songModel.vocalPerformance?.guideTrackId || null,
    status: 'ready',
    authority: 'master_vocal_performance',
    source,
    performance: performance || project.songModel.vocalPerformance?.performance || {},
    preservationRequired: true,
  };
  project.songModel.voice = {
    ...project.songModel.voice,
    replacementLock: VOICE_REPLACEMENT_LOCK,
    replacementStatus: project.songModel.voice?.personalProfile ? 'ready' : 'needs_personal_voice',
  };
  return project;
}

export function attachAuthorizedPersonalVoice(project, profile) {
  if (!profile?.id) throw new TypeError('Perfil de voz sem id.');
  ensureSongModelV3(project);
  project.songModel.voice = {
    ...project.songModel.voice,
    personalProfile: {
      ...profile,
      authorized: profile.authorized === true,
      kind: 'personal',
    },
  };
  project.songModel.voice.replacementStatus = project.songModel.vocalPerformance?.status === 'ready' && profile.authorized === true
    ? 'ready'
    : project.songModel.vocalPerformance?.status === 'ready'
      ? 'needs_voice_authorization'
      : 'needs_master_vocal_performance';
  return project;
}

export function validateVoiceReplacementDelta(delta = {}) {
  const changed = new Set(Object.keys(delta).filter((key) => delta[key] !== undefined));
  const violations = VOICE_REPLACEMENT_LOCK.immutable.filter((field) => changed.has(field));
  return {
    ok: violations.length === 0,
    violations,
    allowed: [...VOICE_REPLACEMENT_LOCK.mutable].filter((field) => changed.has(field)),
    action: violations.length ? 'reject_render' : 'allow_voice_render',
  };
}

function latestSongTake(project) {
  const takes = Array.isArray(project.songCreation?.takes) ? project.songCreation.takes : [];
  if (!takes.length) return null;
  const latestId = project.songCreation?.latestTakeId;
  return takes.find((take) => take?.id === latestId) || takes[takes.length - 1] || null;
}

function resolveNativePerformance(take, previous) {
  if (take?.vocalPerformance?.schema === PABLOVOICE_VOCAL_PERFORMANCE_SCHEMA) return take.vocalPerformance;
  if (take?.vocalPerformance?.status === 'ready') return take.vocalPerformance;
  if (previous?.status === 'ready' && previous?.authority === 'master_vocal_performance') return previous;
  return null;
}

function isInstrumentalTake(take) {
  return Boolean(take && (take.instrumentalOnly === true || take.mode === 'instrumental' || take.creationMode === 'instrumental_first'));
}

function isStemTrack(track) {
  const role = String(track?.role || '');
  const kind = String(track?.kind || '');
  return role.includes('stem') || /stem|generated_instrumental|guide_vocal|vocal/.test(kind);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function copyArray(value) {
  return Array.isArray(value) ? value.map((item) => (item && typeof item === 'object' ? { ...item } : item)) : [];
}