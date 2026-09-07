import { MUSICAL_INTENT_SCHEMA } from './musical-intent.mjs';

export const MUSIC_SPEC_V2_SCHEMA = 'pablovoice_music_spec_v2';

export function upgradeSongPlanToMusicSpec(plan = {}, { intent = null } = {}) {
  if (!plan || typeof plan !== 'object') throw new TypeError('song_plan_required');
  if (!Array.isArray(plan.sections) || plan.sections.length === 0) throw new TypeError('song_plan_sections_required');

  const normalizedIntent = normalizeIntent(intent);
  const spec = {
    schema: MUSIC_SPEC_V2_SCHEMA,
    sourceSchema: String(plan.schema || '') || null,
    compatibility: Object.freeze({
      preservesSongPlanFields: true,
      providerNeutral: true,
      nonDestructiveByDefault: true,
    }),
    identity: Object.freeze({
      brief: bounded(plan.brief, 1200),
      genre: bounded(plan.genre, 120),
      mood: bounded(plan.mood, 120),
      bpm: finite(plan.bpm),
      key: bounded(plan.key, 16),
      mode: bounded(plan.mode, 16),
    }),
    structure: Object.freeze({
      totalBars: finite(plan.totalBars),
      totalBeats: finite(plan.totalBeats),
      durationSeconds: finite(plan.durationSeconds),
      sections: Object.freeze(plan.sections.map((section) => Object.freeze({ ...structuredClone(section) }))),
    }),
    material: Object.freeze({
      progression: freezeArray(plan.progression),
      padNotes: freezeArray(plan.padNotes),
      bassNotes: freezeArray(plan.bassNotes),
      accentNotes: freezeArray(plan.accentNotes),
      guideNotes: freezeArray(plan.guideNotes),
      guideLines: freezeArray(plan.guideLines),
      drumEvents: freezeArray(plan.drumEvents),
    }),
    creativeControls: Object.freeze({
      deltas: Object.freeze({ ...(normalizedIntent?.deltas || {}) }),
      stylePositive: Object.freeze([...(normalizedIntent?.style?.positive || [])]),
      styleNegative: Object.freeze([...(normalizedIntent?.style?.negative || [])]),
      eraHints: Object.freeze([...(normalizedIntent?.style?.eraHints || [])]),
    }),
    operation: Object.freeze({
      section: normalizedIntent?.scope?.section || null,
      target: normalizedIntent?.scope?.target || null,
      preserveUnselected: normalizedIntent?.scope?.preserveUnselected !== false,
      versionReference: normalizedIntent?.versionReference || null,
    }),
    provenance: Object.freeze({
      intentSchema: normalizedIntent?.schema || null,
      intentEvidence: Object.freeze([...(normalizedIntent?.evidence || [])]),
      originalSeed: Number.isFinite(Number(plan.seed)) ? Number(plan.seed) : null,
    }),
  };

  return Object.freeze(spec);
}

export function musicSpecProviderContext(spec = {}) {
  if (spec?.schema !== MUSIC_SPEC_V2_SCHEMA) throw new TypeError('music_spec_v2_required');
  return Object.freeze({
    brief: spec.identity?.brief || '',
    genre: spec.identity?.genre || '',
    mood: spec.identity?.mood || '',
    bpm: spec.identity?.bpm || null,
    key: spec.identity?.key || '',
    mode: spec.identity?.mode || '',
    section: spec.operation?.section || null,
    target: spec.operation?.target || null,
    positiveStyles: Object.freeze([...(spec.creativeControls?.stylePositive || [])]),
    negativeStyles: Object.freeze([...(spec.creativeControls?.styleNegative || [])]),
    eraHints: Object.freeze([...(spec.creativeControls?.eraHints || [])]),
    deltas: Object.freeze({ ...(spec.creativeControls?.deltas || {}) }),
    preserveUnselected: spec.operation?.preserveUnselected !== false,
  });
}

function normalizeIntent(intent) {
  if (intent == null) return null;
  if (!intent || intent.schema !== MUSICAL_INTENT_SCHEMA || intent.supported !== true) {
    throw new TypeError('valid_musical_intent_required');
  }
  return intent;
}

function freezeArray(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.map((item) => {
    if (item && typeof item === 'object') return Object.freeze(structuredClone(item));
    return item;
  }));
}

function bounded(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
