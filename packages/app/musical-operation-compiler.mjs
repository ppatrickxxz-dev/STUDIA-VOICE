import { MUSICAL_OPERATION_ROUTE_SCHEMA } from '../music-intelligence/src/operation-router.mjs';

// Section timing reaches executors only after resolution against the canonical
// project Music Graph; this compiler never persists a second musical state.
export const MUSICAL_EXECUTION_PLAN_SCHEMA = 'pablovoice_musical_execution_plan_v1';

export function compileMusicalOperation(route = {}, project = {}) {
  if (!route || route.schema !== MUSICAL_OPERATION_ROUTE_SCHEMA) {
    throw new TypeError('valid_musical_operation_route_required');
  }

  if (route.executor === 'instrument_lab') return compileInstrument(route, project);
  if (route.executor === 'beat_lab') return compileBeat(route, project);
  if (route.executor === 'music_generation') return compileGeneration(route);
  if (route.executor === 'version_history') return ready(route, {
    executor: 'version_history',
    action: 'preview_previous_take',
    args: { versionReference: route.payload?.versionReference || 'prefer_previous' },
  });
  if (route.executor === 'audio_dsp') {
    return blocked(route, 'specific_dsp_mapping_required', {
      executor: 'audio_dsp',
      fallback: [],
      note: 'A direção de mix foi entendida, mas ainda não existe um mapeamento DSP seguro para esses deltas subjetivos.',
    });
  }

  return blocked(route, 'execution_target_unavailable', { executor: route.executor || 'review_only', fallback: route.fallback || [] });
}

function compileInstrument(route, project) {
  const target = route.scope?.target || null;
  const sectionScope = resolvedSectionScope(route.scope);
  if (route.scope?.section && !sectionScope) {
    return blocked(route, 'instrument_section_mapping_unavailable', {
      executor: 'instrument_lab',
      fallback: route.fallback || ['music_generation'],
    });
  }

  const expectedPreset = ({ bass: 'bass', piano: 'warm_keys', synth: 'soft_pad' })[target] || null;
  if (target === 'guitar') {
    return blocked(route, 'instrument_target_unsupported_local', {
      executor: 'instrument_lab',
      fallback: route.fallback || ['music_generation'],
    });
  }

  const state = project?.instrumentLab;
  if (!state || !Array.isArray(state.notes) || state.notes.length === 0) {
    return blocked(route, 'instrument_notes_required', {
      executor: 'instrument_lab',
      fallback: route.fallback || ['music_generation'],
    });
  }

  if (expectedPreset && String(state.preset || '') !== expectedPreset) {
    return blocked(route, 'instrument_target_mismatch', {
      executor: 'instrument_lab',
      fallback: route.fallback || ['music_generation'],
      expectedPreset,
      actualPreset: String(state.preset || '') || null,
    });
  }

  const deltas = route.payload?.deltas || {};
  const humanize = positive(deltas.humanize);
  const syncopation = positive(deltas.syncopation);
  const durationVariation = positive(deltas.noteVariation);
  if (humanize === 0 && syncopation === 0 && durationVariation === 0) {
    return blocked(route, 'instrument_local_delta_unavailable', {
      executor: 'instrument_lab',
      fallback: route.fallback || ['music_generation'],
    });
  }

  return ready(route, {
    executor: 'instrument_lab',
    action: 'reshape_groove',
    args: {
      target,
      sourcePreset: String(state.preset || ''),
      humanize,
      syncopation,
      durationVariation,
      section: route.scope?.section || null,
      sectionId: sectionScope?.id || null,
      sectionStartSeconds: sectionScope?.startSeconds ?? null,
      sectionEndSeconds: sectionScope?.endSeconds ?? null,
      preservePitch: true,
      preserveNoteCount: true,
      preserveOutsideSection: Boolean(sectionScope),
    },
  });
}

function compileBeat(route, project) {
  if (!project?.beatLab) {
    return blocked(route, 'beat_lab_required', {
      executor: 'beat_lab',
      fallback: route.fallback || ['music_generation'],
    });
  }

  const sectionScope = resolvedSectionScope(route.scope);
  if (route.scope?.section) {
    if (!sectionScope) {
      return blocked(route, 'beat_section_mapping_unavailable', {
        executor: 'beat_lab',
        fallback: route.fallback || ['music_generation'],
        note: 'O pedido é regional, mas a seção ainda não foi resolvida no Music Graph.',
      });
    }
    return blocked(route, 'beat_section_local_executor_required', {
      executor: 'beat_lab',
      fallback: route.fallback || ['music_generation'],
      note: 'O Beat Lab atual humaniza o padrão inteiro. Não vou aplicar uma mutação global fingindo que ficou limitada à seção resolvida.',
    });
  }

  const deltas = route.payload?.deltas || {};
  const humanize = positive(deltas.humanize);
  const handled = humanize > 0 ? ['humanize'] : [];
  const unhandled = Object.entries(deltas)
    .filter(([key, value]) => Number(value) !== 0 && !handled.includes(key))
    .map(([key]) => key);

  if (humanize === 0) {
    return blocked(route, 'beat_local_delta_unavailable', {
      executor: 'beat_lab',
      fallback: route.fallback || ['music_generation'],
      unhandledDeltas: unhandled,
    });
  }

  return ready(route, {
    executor: 'beat_lab',
    action: 'humanize',
    args: { amount: clamp(humanize, 0, 0.65) },
    partial: unhandled.length > 0,
    unhandledDeltas: unhandled,
    fallback: unhandled.length ? (route.fallback || ['music_generation']) : [],
  });
}

function compileGeneration(route) {
  const deltas = route.payload?.deltas || {};
  const positiveStyles = [...(route.payload?.positiveStyles || [])];
  const negativeStyles = [...(route.payload?.negativeStyles || [])];
  const eraHints = [...(route.payload?.eraHints || [])];
  const direction = describeDirection(deltas, positiveStyles, eraHints);
  if (route.action === 'regenerate_section') {
    if (!route.scope?.section) return blocked(route, 'section_required_for_regeneration', { executor: 'music_generation' });
    const sectionScope = resolvedSectionScope(route.scope);
    return ready(route, {
      executor: 'music_generation',
      action: 'regenerate_section',
      args: {
        section: route.scope.section,
        sectionId: sectionScope?.id || null,
        sectionStartSeconds: sectionScope?.startSeconds ?? null,
        sectionEndSeconds: sectionScope?.endSeconds ?? null,
        direction,
        negativeStyles,
        preserveUnselected: route.scope?.preserveUnselected !== false,
      },
    });
  }

  return ready(route, {
    executor: 'music_generation',
    action: route.action,
    args: { direction, negativeStyles, preserveUnselected: route.scope?.preserveUnselected !== false },
  });
}

function resolvedSectionScope(scope = {}) {
  const startSeconds = finite(scope.sectionStartSeconds);
  const endSeconds = finite(scope.sectionEndSeconds);
  if (startSeconds == null || endSeconds == null || endSeconds <= startSeconds) return null;
  return Object.freeze({
    id: String(scope.sectionId || '') || null,
    startSeconds,
    endSeconds,
  });
}

function describeDirection(deltas, positiveStyles, eraHints) {
  const changes = Object.entries(deltas)
    .filter(([, value]) => Number(value) !== 0)
    .map(([key, value]) => `${key} ${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}`);
  return [
    ...positiveStyles,
    ...eraHints.map((era) => `${era} production character`),
    changes.length ? `musical deltas: ${changes.join(', ')}` : '',
  ].filter(Boolean).join('; ').slice(0, 900);
}

function ready(route, compiled) {
  return Object.freeze({
    ok: true,
    schema: MUSICAL_EXECUTION_PLAN_SCHEMA,
    routeSchema: route.schema,
    executor: compiled.executor,
    action: compiled.action,
    args: Object.freeze({ ...(compiled.args || {}) }),
    partial: compiled.partial === true,
    unhandledDeltas: Object.freeze([...(compiled.unhandledDeltas || [])]),
    fallback: Object.freeze([...(compiled.fallback || [])]),
    constraints: Object.freeze({
      reviewRequired: true,
      canApply: false,
      nonDestructive: true,
      preserveUnselected: route.scope?.preserveUnselected !== false,
    }),
  });
}

function blocked(route, reason, extra = {}) {
  return Object.freeze({
    ok: false,
    schema: MUSICAL_EXECUTION_PLAN_SCHEMA,
    routeSchema: route.schema,
    reason,
    executor: extra.executor || route.executor || null,
    fallback: Object.freeze([...(extra.fallback || [])]),
    ...(extra.note ? { note: extra.note } : {}),
    ...(extra.expectedPreset ? { expectedPreset: extra.expectedPreset } : {}),
    ...(extra.actualPreset ? { actualPreset: extra.actualPreset } : {}),
    ...(extra.unhandledDeltas ? { unhandledDeltas: Object.freeze([...extra.unhandledDeltas]) } : {}),
    constraints: Object.freeze({ reviewRequired: true, canApply: false, nonDestructive: true }),
  });
}

function positive(value) { return clamp(Number(value) || 0, 0, 1); }
function finite(value) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function clamp(value, min, max) { return Math.max(min, Math.min(max, Number(value) || 0)); }
