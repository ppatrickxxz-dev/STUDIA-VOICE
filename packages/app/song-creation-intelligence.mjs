import { buildConcept } from '../music-intelligence/src/concept-engine.mjs';
import { critiqueLyrics } from '../music-intelligence/src/critic.mjs';

export const SONG_CREATION_INTELLIGENCE_SCHEMA = 'pablovoice_song_creation_intelligence_v1';

export function resolveSongCreationLyrics({ lyrics = '', instrumentalFirst = false } = {}) {
  const sourceLyrics = String(lyrics || '').trim();
  const startInstrumentalFirst = Boolean(instrumentalFirst) || !sourceLyrics;
  return Object.freeze({
    projectLyrics: sourceLyrics,
    planLyrics: startInstrumentalFirst ? '' : sourceLyrics,
    creationMode: startInstrumentalFirst ? 'instrumental_first' : 'lyrics_led',
  });
}

export function buildSongCreationIntelligence({ brief = '', genre = '', mood = '', lyrics = '', creationMode = 'lyrics_led' } = {}) {
  const concept = buildConcept(brief, { genre, mood });
  const critique = String(lyrics || '').trim()
    ? critiqueLyrics(lyrics, { concept })
    : null;

  return Object.freeze({
    schema: SONG_CREATION_INTELLIGENCE_SCHEMA,
    engine: 'pmi-music-1.0',
    creationMode: creationMode === 'instrumental_first' ? 'instrumental_first' : 'lyrics_led',
    concept: Object.freeze({
      premise: concept.premise,
      anchors: [...concept.anchors],
      emotions: [...concept.emotions],
      pointOfView: concept.pointOfView,
      tension: concept.tension,
      payoff: concept.payoff,
      directions: concept.directions.map((item) => Object.freeze({
        id: item.id,
        label: item.label,
        angle: item.angle,
        priority: item.priority,
      })),
    }),
    lyricCritique: critique ? Object.freeze({
      severity: critique.severity,
      dimensions: Object.freeze({ ...critique.dimensions }),
      issues: critique.issues.slice(0, 5).map((item) => Object.freeze({
        code: item.code,
        severity: item.severity,
        action: item.action,
      })),
      strengths: critique.strengths.slice(0, 5),
    }) : null,
  });
}
