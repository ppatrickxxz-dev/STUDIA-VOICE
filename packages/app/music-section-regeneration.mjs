export const MUSIC_SECTION_REGEN_SCHEMA = 'pablovoice_music_section_regeneration_v1';

export function latestInpaintableSongTake(project = {}) {
  const takes = Array.isArray(project?.songCreation?.takes) ? project.songCreation.takes : [];
  return [...takes].reverse().find((take) => String(take?.providerSongId || take?.render?.songId || '').trim()) || null;
}

export function resolveSectionRegeneration(project = {}, sectionId = '', {
  direction = '',
  lyrics = null,
  negativeStyles = [],
} = {}) {
  const take = latestInpaintableSongTake(project);
  if (!take) return Object.freeze({ ok: false, error: 'inpainting_source_missing' });

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
    sourceSongId: String(take.providerSongId || take.render?.songId),
    durationMs: Math.round(takeDuration * 1000),
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
