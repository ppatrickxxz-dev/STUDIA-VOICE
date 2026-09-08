export const MUSIC_SECTION_REGEN_SCHEMA = 'pablovoice_music_section_regeneration_v2';

export function latestInpaintableSongTake(project = {}) {
  const takes = Array.isArray(project?.songCreation?.takes) ? project.songCreation.takes : [];
  return [...takes].reverse().find((take) => nativeSourceAssetId(take) || providerSongId(take)) || null;
}

export function regenerationSourceForTake(take = {}) {
  const sourceAssetId = nativeSourceAssetId(take);
  if (sourceAssetId) {
    return Object.freeze({
      type: 'native_asset',
      sourceAssetId,
      sourceSongId: null,
      provider: String(take?.render?.provider || 'kaggle'),
      model: String(take?.render?.model || 'acestep-v15-turbo'),
    });
  }
  const sourceSongId = providerSongId(take);
  if (sourceSongId) {
    return Object.freeze({
      type: 'provider_song_id',
      sourceAssetId: null,
      sourceSongId,
      provider: String(take?.render?.provider || 'elevenmusic'),
      model: String(take?.render?.model || 'music_v2'),
    });
  }
  return null;
}

export function resolveSectionRegeneration(project = {}, sectionId = '', {
  direction = '',
  lyrics = null,
  negativeStyles = [],
} = {}) {
  const take = latestInpaintableSongTake(project);
  if (!take) return Object.freeze({ ok: false, error: 'inpainting_source_missing' });
  const source = regenerationSourceForTake(take);
  if (!source) return Object.freeze({ ok: false, error: 'inpainting_source_missing' });

  const sections = Array.isArray(project?.arrangementMap?.sections)
    ? [...project.arrangementMap.sections].sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
    : [];
  const index = sections.findIndex((section) => section.id === sectionId);
  if (index < 0) return Object.freeze({ ok: false, error: 'section_not_found' });
  const section = sections[index];
  const startSeconds = Number(section.startSeconds);
  const nextStart = Number(sections[index + 1]?.startSeconds);
  const explicitEnd = Number(section.endSeconds);
  const takeDuration = Number(take.durationSeconds);
  const endSeconds = Number.isFinite(explicitEnd) && explicitEnd > startSeconds
    ? explicitEnd
    : Number.isFinite(nextStart) && nextStart > startSeconds
      ? nextStart
      : takeDuration;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds || !Number.isFinite(takeDuration) || takeDuration <= 0) {
    return Object.freeze({ ok: false, error: 'section_timing_incomplete' });
  }

  const sourceLyrics = lyrics == null ? lyricsForRange(take.guideLines, startSeconds, endSeconds, Number(take.bpm)) : String(lyrics).trim();
  const label = String(section.label || section.kind || 'Seção').trim();
  const text = sourceLyrics ? `[${label}]\n${sourceLyrics}` : `[${label} instrumental]`;
  const musicalDirection = String(direction || '').trim().slice(0, 500);
  const styles = compactStyles([
    musicalDirection,
    take.brief,
    take.genre,
    take.mood,
    Number.isFinite(Number(take.bpm)) ? `${Math.round(Number(take.bpm))} BPM` : '',
    take.key ? `${take.key} ${take.mode === 'major' ? 'major' : 'minor'}` : '',
  ]);
  const negatives = compactStyles(negativeStyles);

  return Object.freeze({
    ok: true,
    schema: MUSIC_SECTION_REGEN_SCHEMA,
    sourceTakeId: take.id,
    sourceType: source.type,
    sourceAssetId: source.sourceAssetId,
    sourceSongId: source.sourceSongId,
    sourceProvider: source.provider,
    sourceModel: source.model,
    durationMs: Math.round(takeDuration * 1000),
    sourceTake: Object.freeze({
      brief: String(take.brief || ''),
      genre: String(take.genre || ''),
      mood: String(take.mood || ''),
      bpm: Number(take.bpm) || null,
      key: String(take.key || ''),
      mode: take.mode === 'major' ? 'major' : 'minor',
      intelligence: take.intelligence ? structuredClone(take.intelligence) : null,
    }),
    section: Object.freeze({
      id: section.id,
      label,
      startMs: Math.round(startSeconds * 1000),
      endMs: Math.round(endSeconds * 1000),
      text,
      positiveStyles: styles,
      negativeStyles: negatives,
      contextAdherence: 'high',
    }),
  });
}

function providerSongId(take = {}) {
  return String(take?.providerSongId || take?.render?.songId || '').trim() || null;
}

function nativeSourceAssetId(take = {}) {
  const id = String(take?.remoteAssetId || take?.render?.remoteAssetId || '').trim();
  const source = String(take?.render?.provider || take?.provider || '').toLowerCase();
  const model = String(take?.render?.model || '').toLowerCase();
  const looksNative = source === 'kaggle' || model.includes('acestep') || String(take?.render?.modelRevision || '').length >= 12;
  return id && looksNative ? id : null;
}

function lyricsForRange(guideLines = [], startSeconds, endSeconds, bpm) {
  if (!Array.isArray(guideLines) || !Number.isFinite(bpm) || bpm <= 0) return '';
  const beatSeconds = 60 / bpm;
  return guideLines
    .filter((line) => {
      const seconds = Number(line?.startBeat) * beatSeconds;
      return Number.isFinite(seconds) && seconds >= startSeconds - 0.001 && seconds < endSeconds - 0.001;
    })
    .map((line) => String(line?.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

function compactStyles(values = []) {
  const output = [];
  const seen = new Set();
  for (const value of values.flat ? values.flat() : values) {
    const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= 12) break;
  }
  return output;
}
