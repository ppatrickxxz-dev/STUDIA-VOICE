import { MUSICAL_INTENT_SCHEMA } from './musical-intent.mjs';

export const MUSICAL_OPERATION_ROUTE_SCHEMA = 'pmi_musical_operation_route_v1';

export function routeMusicalIntent(intent = {}, context = {}) {
  if (!intent || intent.schema !== MUSICAL_INTENT_SCHEMA || intent.supported !== true) {
    throw new TypeError('valid_musical_intent_required');
  }

  const route = resolveRoute(intent);
  return Object.freeze({
    schema: MUSICAL_OPERATION_ROUTE_SCHEMA,
    intentSchema: intent.schema,
    executor: route.executor,
    action: route.action,
    strategy: route.strategy,
    fallback: Object.freeze([...route.fallback]),
    scope: Object.freeze({
      section: intent.scope?.section || null,
      target: intent.scope?.target || null,
      preserveUnselected: intent.scope?.preserveUnselected !== false,
    }),
    constraints: Object.freeze({
      reviewRequired: true,
      canApply: false,
      nonDestructive: true,
      preserveUnselected: intent.scope?.preserveUnselected !== false,
    }),
    payload: Object.freeze({
      deltas: Object.freeze({ ...(intent.deltas || {}) }),
      positiveStyles: Object.freeze([...(intent.style?.positive || [])]),
      negativeStyles: Object.freeze([...(intent.style?.negative || [])]),
      eraHints: Object.freeze([...(intent.style?.eraHints || [])]),
      versionReference: intent.versionReference || null,
    }),
    context: Object.freeze({
      projectId: String(context.projectId || intent.context?.projectId || '') || null,
      trackId: String(context.trackId || intent.context?.trackId || '') || null,
    }),
  });
}

function resolveRoute(intent) {
  if (intent.versionReference === 'prefer_previous') {
    return route('version_history', 'preview_previous_take', 'reference_only', []);
  }

  const target = intent.scope?.target || null;
  const section = intent.scope?.section || null;

  if (target === 'drums') {
    return route('beat_lab', 'edit_beat_pattern', 'deterministic_first', ['music_generation']);
  }

  if (['bass', 'synth', 'piano', 'guitar'].includes(target)) {
    return route('instrument_lab', 'edit_instrument_pattern', 'midi_first', ['music_generation']);
  }

  if (target === 'mix') {
    return route('audio_dsp', 'preview_mix_adjustment', 'dsp_first', []);
  }

  if (target === 'arrangement' || section) {
    return route('music_generation', section ? 'regenerate_section' : 'generate_arrangement_variant', 'generative_scoped', []);
  }

  if (hasStyleDirection(intent) || Object.keys(intent.deltas || {}).length > 0) {
    return route('music_generation', 'generate_controlled_variant', 'generative_scoped', []);
  }

  return route('review_only', 'clarify_execution_target', 'review_only', []);
}

function hasStyleDirection(intent) {
  return Boolean(
    intent.style?.positive?.length
    || intent.style?.negative?.length
    || intent.style?.eraHints?.length,
  );
}

function route(executor, action, strategy, fallback) {
  return { executor, action, strategy, fallback };
}
