import { MUSICAL_INTENT_SCHEMA } from './musical-intent.mjs';
import {
  PROJECT_MUSIC_GRAPH_SCHEMA,
  buildProjectMusicGraph,
  resolveMusicGraphScope,
} from './project-music-graph.mjs';

export const MUSICAL_OPERATION_ROUTE_SCHEMA = 'pmi_musical_operation_route_v1';

export function routeMusicalIntent(intent = {}, context = {}) {
  if (!intent || intent.schema !== MUSICAL_INTENT_SCHEMA || intent.supported !== true) {
    throw new TypeError('valid_musical_intent_required');
  }

  const route = resolveRoute(intent);
  const graph = resolveProjectGraph(context);
  const graphScope = graph ? resolveMusicGraphScope(graph, {
    trackId: context.trackId || intent.context?.trackId || null,
    target: intent.scope?.target || null,
    section: intent.scope?.section || null,
    occurrence: intent.scope?.occurrence || 1,
  }) : null;
  const resolvedSection = graphScope?.section || null;
  const resolvedTrack = graphScope?.track || null;

  return Object.freeze({
    schema: MUSICAL_OPERATION_ROUTE_SCHEMA,
    intentSchema: intent.schema,
    executor: route.executor,
    action: route.action,
    strategy: route.strategy,
    fallback: Object.freeze([...route.fallback]),
    scope: Object.freeze({
      section: intent.scope?.section || null,
      sectionId: resolvedSection?.id || null,
      sectionStartSeconds: finite(resolvedSection?.startSeconds),
      sectionEndSeconds: finite(resolvedSection?.endSeconds),
      target: intent.scope?.target || null,
      resolvedTrackId: resolvedTrack?.id || null,
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
      projectId: String(context.projectId || graph?.project?.id || intent.context?.projectId || '') || null,
      trackId: String(context.trackId || resolvedTrack?.id || intent.context?.trackId || '') || null,
      musicGraphSchema: graph?.schema || null,
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

function resolveProjectGraph(context = {}) {
  if (context?.musicGraph?.schema === PROJECT_MUSIC_GRAPH_SCHEMA) return context.musicGraph;
  if (context?.project && typeof context.project === 'object') {
    return buildProjectMusicGraph(context.project, {
      pendingDraft: context.pendingDraft || null,
      pmiSession: context.pmiSession || null,
      mixState: context.mixState || null,
    });
  }
  return null;
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

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
