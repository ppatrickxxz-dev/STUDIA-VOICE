import { compileMusicalOperation } from './musical-operation-compiler.mjs';
import { applyPabloInstrumentOperation } from './pablo-instrument-operations.mjs';
import { applyPabloBeatOperation } from './pablo-beat-operations.mjs';

export const MUSICAL_PLAN_REVIEW_SCHEMA = 'pablovoice_musical_plan_review_v1';

export async function buildMusicalPlanReview(message = '', project = null, context = {}) {
  if (!project || typeof project !== 'object') return blockedReview('project_required');
  const source = String(message || '').trim();
  if (!source) return blockedReview('empty_message');

  const intelligence = await loadMusicIntelligence();
  if (!intelligence?.respondToMusicCreation) return blockedReview('music_intelligence_unavailable');

  const activeTrack = project.tracks?.find((track) => track.id === project.activeTrackId) || project.tracks?.[0] || null;
  const planning = intelligence.respondToMusicCreation(source, {
    ...context,
    projectId: project.id,
    trackId: context.trackId || activeTrack?.id || null,
    lyrics: context.lyrics ?? project.lyrics ?? '',
    notes: context.notes ?? project.notes ?? '',
    preset: context.preset ?? project.preset ?? null,
  });

  if (!planning?.supported || planning.kind !== 'pmi_musical_intent_plan' || !planning.operationRoute) {
    return blockedReview('musical_intent_plan_unavailable');
  }

  let operationRoute = planning.operationRoute;
  if (planning.musicalIntent && typeof intelligence.routeMusicalIntent === 'function') {
    try {
      operationRoute = intelligence.routeMusicalIntent(planning.musicalIntent, {
        ...context,
        project,
        projectId: project.id,
        trackId: context.trackId || activeTrack?.id || null,
      });
    } catch {
      operationRoute = planning.operationRoute;
    }
  }

  let executionPlan;
  try {
    executionPlan = compileMusicalOperation(operationRoute, project);
  } catch {
    return blockedReview('musical_execution_compile_failed', { planning });
  }

  return Object.freeze({
    supported: true,
    ok: true,
    schema: MUSICAL_PLAN_REVIEW_SCHEMA,
    source: source.slice(0, 1200),
    projectId: String(project.id || ''),
    reply: String(planning.reply || 'Entendi a direção musical e preparei um plano revisável.'),
    musicalIntent: planning.musicalIntent,
    operationRoute,
    executionPlan,
    musicGraphSchema: operationRoute?.context?.musicGraphSchema || null,
    reviewRequired: true,
    stateFingerprint: musicalExecutionFingerprint(project, executionPlan),
  });
}

export function validateMusicalPlanReview(review = {}, project = null) {
  if (!review || review.schema !== MUSICAL_PLAN_REVIEW_SCHEMA || review.supported !== true) {
    return Object.freeze({ ok: false, reason: 'valid_musical_review_required' });
  }
  if (!project || typeof project !== 'object') return Object.freeze({ ok: false, reason: 'project_required' });
  if (String(project.id || '') !== String(review.projectId || '')) {
    return Object.freeze({ ok: false, reason: 'project_changed' });
  }
  const currentFingerprint = musicalExecutionFingerprint(project, review.executionPlan);
  if (currentFingerprint !== review.stateFingerprint) {
    return Object.freeze({ ok: false, reason: 'musical_state_drift' });
  }
  return Object.freeze({ ok: true, reason: null });
}

export async function materializeMusicalPlanReview(review = {}, project = null) {
  const validation = validateMusicalPlanReview(review, project);
  if (!validation.ok) return Object.freeze({ ok: false, mutated: false, reason: validation.reason });

  let freshPlan;
  try {
    freshPlan = compileMusicalOperation(review.operationRoute, project);
  } catch {
    return Object.freeze({ ok: false, mutated: false, reason: 'musical_execution_compile_failed' });
  }
  if (!freshPlan?.ok) {
    return Object.freeze({ ok: false, mutated: false, reason: freshPlan?.reason || 'musical_execution_unavailable', plan: freshPlan });
  }

  if (freshPlan.executor === 'instrument_lab') return applyPabloInstrumentOperation(project, freshPlan);
  if (freshPlan.executor === 'beat_lab') return applyPabloBeatOperation(project, { action: freshPlan.action, args: freshPlan.args });

  return Object.freeze({
    ok: false,
    mutated: false,
    reason: 'review_executor_not_locally_materialized',
    plan: freshPlan,
  });
}

export function musicalExecutionFingerprint(project = {}, plan = {}) {
  const executor = String(plan?.executor || 'review_only');
  let state;
  if (executor === 'instrument_lab') {
    state = {
      instrumentLab: project.instrumentLab || null,
      arrangementMap: project.arrangementMap || null,
    };
  } else if (executor === 'beat_lab') {
    state = { beatLab: project.beatLab || null, sampler: project.sampler || null, arrangementMap: project.arrangementMap || null };
  } else if (executor === 'music_generation') {
    state = {
      arrangementMap: project.arrangementMap || null,
      tracks: (project.tracks || []).map(({ id, assetId, duration, offset, trimStart, trimEnd, providerSongId }) => ({
        id,
        assetId,
        duration,
        offset,
        trimStart,
        trimEnd,
        providerSongId: providerSongId || null,
      })),
      songCreation: {
        latestTakeId: project.songCreation?.latestTakeId || null,
        takes: (project.songCreation?.takes || []).map(({ id, providerSongId, referenceTrackId, durationSeconds, derivedFromTakeId }) => ({
          id,
          providerSongId: providerSongId || null,
          referenceTrackId: referenceTrackId || null,
          durationSeconds: Number(durationSeconds) || null,
          derivedFromTakeId: derivedFromTakeId || null,
        })),
      },
    };
  } else if (executor === 'version_history') {
    state = (project.revisions || []).map(({ id, at, label }) => ({ id, at, label }));
  } else if (executor === 'audio_dsp') {
    state = (project.tracks || []).map(({ id, gain, pan, muted, solo, effects, regionAutomation }) => ({ id, gain, pan, muted, solo, effects, regionAutomation }));
  } else {
    state = null;
  }
  return stableStringify({ projectId: String(project.id || ''), executor, state });
}

export function describeMusicalExecutionPlan(plan = {}) {
  if (!plan?.ok) return blockedPlanMessage(plan?.reason);
  if (plan.executor === 'instrument_lab') {
    const target = humanTarget(plan.args?.target);
    const section = plan.args?.section ? ` em ${humanSection(plan.args.section)}` : '';
    return `${target}${section} · ajuste MIDI reversível de timing, dinâmica e duração; pitch e quantidade de notas ficam preservados; material fora da seleção também.`;
  }
  if (plan.executor === 'beat_lab') {
    const amount = Math.round((Number(plan.args?.amount) || 0) * 100);
    const partial = plan.partial
      ? ` Parte local segura; ${humanDeltas(plan.unhandledDeltas)} continuam pendentes em vez de serem fingidos.`
      : '';
    return `Bateria · humanização determinística em ${amount}%.${partial}`;
  }
  if (plan.executor === 'music_generation') {
    return plan.action === 'regenerate_section'
      ? `Edição por seção preparada para ${humanSection(plan.args?.section)}; o restante da música será preservado.`
      : 'Nova versão musical preparada para revisão; ainda não foi enviada para produção conectada.';
  }
  if (plan.executor === 'version_history') return 'Referência à versão anterior preparada; nenhum take foi trocado automaticamente.';
  if (plan.executor === 'audio_dsp') return 'Direção de mix entendida, mas mantida em revisão até existir mapeamento DSP seguro.';
  return 'Plano musical preparado para revisão; o projeto ainda não foi alterado.';
}

export function humanizeMusicalReviewError(reason = '') {
  const messages = {
    project_required: 'Crie ou abra um projeto primeiro.',
    project_changed: 'O projeto ativo mudou desde a análise. Faça o pedido novamente para eu recalcular com o estado atual.',
    musical_state_drift: 'O estado musical mudou desde a análise. Não apliquei um plano antigo; faça o pedido novamente sobre a versão atual.',
    music_intelligence_unavailable: 'A inteligência musical local não está disponível nesta versão.',
    musical_intent_plan_unavailable: 'Esse pedido não terminou em um plano instrumental aplicável.',
    musical_execution_compile_failed: 'Não consegui compilar esse pedido para um executor seguro.',
    review_executor_not_locally_materialized: 'O plano está entendido, mas esse executor ainda exige o fluxo dedicado antes de aplicar.',
    instrument_notes_required: 'O Instrument Lab precisa ter notas gravadas antes desse ajuste.',
    instrument_target_mismatch: 'O instrumento ativo não corresponde ao alvo entendido no pedido.',
    instrument_section_mapping_unavailable: 'Essa seção ainda não está confirmada de forma única no cérebro musical para editar o instrumento com segurança.',
    instrument_target_unsupported_local: 'Esse instrumento ainda não tem executor MIDI local seguro.',
    beat_lab_required: 'Abra ou crie um Beat Lab antes desse ajuste.',
    beat_section_mapping_unavailable: 'Essa seção ainda não está confirmada de forma única no cérebro musical para editar a bateria.',
    beat_section_local_executor_required: 'O Beat Lab atual humaniza o padrão inteiro. Não apliquei isso como se fosse uma edição apenas da seção pedida.',
    beat_local_delta_unavailable: 'O Beat Lab local ainda não consegue executar esse detalhe sem inventar comportamento.',
    specific_dsp_mapping_required: 'A direção de mix foi entendida, mas ainda precisa de um mapeamento DSP específico.',
    musical_execution_unavailable: 'O executor musical necessário não está disponível agora.',
  };
  return messages[String(reason || '')] || 'Não consegui aplicar esse plano com segurança; o projeto ficou intacto.';
}

function blockedReview(reason, extra = {}) {
  return Object.freeze({ supported: false, ok: false, schema: MUSICAL_PLAN_REVIEW_SCHEMA, reason, ...extra });
}

function blockedPlanMessage(reason) {
  return `${humanizeMusicalReviewError(reason || 'musical_execution_unavailable')} Não alterei o projeto.`;
}

function humanTarget(value) {
  return ({ bass: 'Baixo', synth: 'Synth', piano: 'Teclas', guitar: 'Guitarra/violão' })[String(value || '')] || 'Instrumento';
}

function humanSection(value) {
  return ({ chorus: 'o refrão', pre_chorus: 'o pré-refrão', verse: 'o verso', bridge: 'a ponte', post_chorus: 'o pós-refrão', intro: 'a intro', outro: 'o outro' })[String(value || '')] || 'a seção selecionada';
}

function humanDeltas(values = []) {
  const labels = { syncopation: 'sincopação', density: 'densidade', energy: 'energia', width: 'abertura', warmth: 'calor', clarity: 'clareza', noteVariation: 'variação de notas', transientSharpness: 'ataque/transientes' };
  return (Array.isArray(values) ? values : []).map((value) => labels[value] || value).join(', ') || 'outros ajustes';
}

function stableStringify(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
}

async function loadMusicIntelligence() {
  for (const specifier of ['./music-intelligence/src/index.mjs', '../music-intelligence/src/index.mjs']) {
    try {
      const module = await import(specifier);
      if (typeof module.respondToMusicCreation === 'function') return module;
    } catch {
      // Packaged runtime and source tests expose canonical packages from different roots.
    }
  }
  return null;
}
