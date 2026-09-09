import { compileMusicalOperation } from './musical-operation-compiler.mjs';
import { MusicGenerationClient } from './music-generation-client.mjs';
import { latestInpaintableSongTake, resolveSectionRegeneration } from './music-section-regeneration.mjs';
import { validateMusicalPlanReview } from './pablo-musical-plan-review.mjs';
import { readStudioPlayhead } from './studio-playhead-context.mjs';
import { buildProjectMusicGraph, PROJECT_MUSIC_GRAPH_SCHEMA } from '../music-intelligence/src/project-music-graph.mjs';

export const REVIEWED_MUSIC_GENERATION_SCHEMA = 'pablovoice_reviewed_music_generation_v1';

export function prepareReviewedSectionRegeneration(review = {}, project = {}, {
  playhead = null,
  now = Date.now(),
} = {}) {
  const validation = validateMusicalPlanReview(review, project);
  if (!validation.ok) return blocked(validation.reason);

  let plan;
  try {
    plan = compileMusicalOperation(review.operationRoute, project);
  } catch {
    return blocked('musical_execution_compile_failed');
  }
  if (!plan?.ok || plan.executor !== 'music_generation' || plan.action !== 'regenerate_section') {
    return blocked(plan?.reason || 'section_regeneration_plan_required', { plan });
  }
  if (plan.args?.preserveUnselected === false) {
    return blocked('preserve_unselected_required', { plan });
  }

  const graph = buildProjectMusicGraph(project);
  const take = latestInpaintableSongTake(project);
  if (!take) return blocked('inpainting_source_missing', { plan });

  const sectionKind = String(plan.args?.section || '');
  const resolvedTarget = resolveSectionTarget(project, sectionKind, {
    playhead: playhead || readStudioPlayhead(project.id, { now }),
    takeDurationSeconds: Number(take.durationSeconds),
  });
  if (!resolvedTarget.ok) return blocked(resolvedTarget.reason, { plan, matches: resolvedTarget.matches });

  const graphBinding = validateGraphSectionBinding(graph, plan, resolvedTarget.section);
  if (!graphBinding.ok) return blocked(graphBinding.reason, { plan, targetSection: resolvedTarget.section });

  const providerPlan = resolveSectionRegeneration(project, resolvedTarget.section.id, {
    direction: plan.args?.direction || '',
    negativeStyles: plan.args?.negativeStyles || [],
  });
  if (!providerPlan.ok) return blocked(providerPlan.error || 'section_regeneration_prepare_failed', { plan });

  return Object.freeze({
    ok: true,
    schema: REVIEWED_MUSIC_GENERATION_SCHEMA,
    projectId: String(project.id || ''),
    musicGraphSchema: graph.schema,
    action: 'regenerate_section',
    sectionKind,
    targetSection: Object.freeze({ ...resolvedTarget.section }),
    targetSource: resolvedTarget.source,
    sourceTakeId: take.id,
    sourceSongId: providerPlan.sourceSongId,
    providerPlan,
    executionPlan: plan,
    preserveUnselected: true,
  });
}

export async function executeReviewedSectionRegeneration(review = {}, project = {}, {
  client = null,
  persist = null,
  playhead = null,
  now = Date.now(),
} = {}) {
  const prepared = prepareReviewedSectionRegeneration(review, project, { playhead, now });
  if (!prepared.ok) return Object.freeze({ ok: false, mutated: false, reason: prepared.reason, prepared });

  const runtime = client || new MusicGenerationClient();
  let result;
  try {
    result = await runtime.regenerateSection({
      localProject: project,
      sourceSongId: prepared.providerPlan.sourceSongId,
      durationMs: prepared.providerPlan.durationMs,
      section: prepared.providerPlan.section,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      mutated: false,
      reason: classifyGenerationError(error?.message || error),
      detail: String(error?.message || '').slice(0, 500) || null,
      prepared,
    });
  }
  if (!result?.ok) {
    return Object.freeze({
      ok: false,
      mutated: false,
      reason: classifyGenerationError(result?.error),
      detail: result?.detail || null,
      requestId: result?.requestId || null,
      prepared,
    });
  }

  let persisted;
  try {
    const persistRuntime = persist || await loadSectionPersistence();
    persisted = await persistRuntime(project, prepared.providerPlan, result);
  } catch (error) {
    return Object.freeze({
      ok: false,
      mutated: false,
      reason: 'section_regeneration_persist_failed',
      detail: String(error?.message || '').slice(0, 500) || null,
      requestId: result?.requestId || null,
      prepared,
    });
  }

  return Object.freeze({
    ok: true,
    mutated: true,
    schema: REVIEWED_MUSIC_GENERATION_SCHEMA,
    musicGraphSchema: prepared.musicGraphSchema,
    project: persisted.project,
    track: persisted.track,
    take: persisted.take,
    takeNumber: persisted.takeNumber,
    section: prepared.targetSection,
    targetSource: prepared.targetSource,
    provider: result.provider || null,
    model: result.model || null,
    requestId: result.requestId || null,
    audioBlob: result.blob,
    preserveUnselected: true,
  });
}

export function resolveSectionTarget(project = {}, sectionKind = '', {
  playhead = null,
  takeDurationSeconds = null,
} = {}) {
  const sections = Array.isArray(project?.arrangementMap?.sections)
    ? [...project.arrangementMap.sections].sort((a, b) => Number(a.startSeconds) - Number(b.startSeconds))
    : [];
  const candidates = sections.filter((section) =>
    section?.kind === sectionKind
    && section?.timingStatus === 'confirmed'
    && Number(section?.confidence) >= 0.8
    && Number.isFinite(Number(section?.startSeconds)));

  if (candidates.length === 0) return Object.freeze({ ok: false, reason: 'section_mapping_required', matches: 0 });
  if (candidates.length === 1) return Object.freeze({ ok: true, section: candidates[0], source: 'unique_confirmed_section', matches: 1 });

  const position = Number(playhead?.seconds);
  if (playhead?.ok && Number.isFinite(position)) {
    const atPlayhead = candidates.filter((candidate) => containsPlayhead(sections, candidate, position, takeDurationSeconds));
    if (atPlayhead.length === 1) {
      return Object.freeze({ ok: true, section: atPlayhead[0], source: 'recent_studio_playhead', matches: candidates.length });
    }
  }

  return Object.freeze({ ok: false, reason: 'section_ambiguous', matches: candidates.length });
}

export function humanizeReviewedGenerationError(reason = '') {
  const messages = {
    section_regeneration_plan_required: 'Esse pedido não terminou em uma edição de seção executável.',
    preserve_unselected_required: 'Não vou refazer a música inteira quando o pedido é local. O restante precisa permanecer preservado.',
    inpainting_source_missing: 'Ainda não existe um take conectado com continuidade para refazer só essa seção.',
    section_mapping_required: 'Essa seção ainda não está confirmada no mapa da música.',
    section_ambiguous: 'Há mais de uma seção desse tipo e o playhead não identifica qual delas você quis alterar.',
    music_graph_scope_drift: 'A seção resolvida mudou em relação ao cérebro musical revisado. Não enviei uma edição para o trecho errado.',
    section_regeneration_prepare_failed: 'Não consegui montar o intervalo seguro dessa seção.',
    auth_required: 'Reconheça este aparelho para criar a nova versão; o take atual foi preservado.',
    provider_unavailable: 'A produção conectada não está disponível agora; o take atual foi preservado.',
    provider_rate_limited: 'A produção conectada atingiu o limite temporário; o take atual foi preservado.',
    provider_auth_failed: 'A credencial da produção conectada precisa ser corrigida no backend; nada foi substituído.',
    provider_request_rejected: 'A produção conectada recusou esse plano; nada foi substituído.',
    invalid_inpainting_plan: 'O intervalo não pôde ser enviado com segurança para edição.',
    section_regeneration_persist_failed: 'A nova versão respondeu, mas não pôde ser salva; o projeto anterior foi preservado.',
    musical_state_drift: 'A música mudou desde a revisão. Não executei um plano antigo.',
    project_changed: 'O projeto ativo mudou desde a revisão. Faça o pedido novamente nesse projeto.',
  };
  return messages[String(reason || '')] || 'Não consegui concluir essa edição com segurança; o take atual foi preservado.';
}

function validateGraphSectionBinding(graph, plan, section) {
  if (graph?.schema !== PROJECT_MUSIC_GRAPH_SCHEMA) return Object.freeze({ ok: false, reason: 'music_graph_scope_drift' });
  const current = (graph.structure?.sections || []).find((item) => item.id === section?.id);
  if (!current) return Object.freeze({ ok: false, reason: 'music_graph_scope_drift' });
  const plannedId = String(plan.args?.sectionId || '');
  if (plannedId && plannedId !== String(current.id || '')) return Object.freeze({ ok: false, reason: 'music_graph_scope_drift' });
  if (plan.args?.sectionStartSeconds != null) {
    const plannedStart = Number(plan.args.sectionStartSeconds);
    if (!Number.isFinite(plannedStart) || Math.abs(plannedStart - Number(current.startSeconds)) > 0.001) {
      return Object.freeze({ ok: false, reason: 'music_graph_scope_drift' });
    }
  }
  if (plan.args?.sectionEndSeconds != null) {
    const plannedEnd = Number(plan.args.sectionEndSeconds);
    if (!Number.isFinite(plannedEnd) || Math.abs(plannedEnd - Number(current.endSeconds)) > 0.001) {
      return Object.freeze({ ok: false, reason: 'music_graph_scope_drift' });
    }
  }
  return Object.freeze({ ok: true, reason: null });
}

function containsPlayhead(allSections, candidate, seconds, takeDurationSeconds) {
  const start = Number(candidate.startSeconds);
  const explicitEnd = Number(candidate.endSeconds);
  const index = allSections.findIndex((section) => section.id === candidate.id);
  const nextStart = Number(allSections[index + 1]?.startSeconds);
  const fallbackEnd = Number(takeDurationSeconds);
  const end = Number.isFinite(explicitEnd) && explicitEnd > start
    ? explicitEnd
    : Number.isFinite(nextStart) && nextStart > start
      ? nextStart
      : Number.isFinite(fallbackEnd) && fallbackEnd > start
        ? fallbackEnd
        : start;
  return seconds >= start && seconds < end;
}

function classifyGenerationError(value = '') {
  const text = String(value || '').toLowerCase();
  if (text.includes('auth_required')) return 'auth_required';
  if (text.includes('rate_limited') || text.includes('429')) return 'provider_rate_limited';
  if (text.includes('auth_failed') || text.includes('(401)') || text.includes('(403)')) return 'provider_auth_failed';
  if (text.includes('request_rejected') || /\(4\d\d\)/.test(text)) return 'provider_request_rejected';
  if (text.includes('invalid_inpainting_plan')) return 'invalid_inpainting_plan';
  if (text.includes('unavailable') || text.includes('remote_') || text.includes('timeout')) return 'provider_unavailable';
  return String(value || 'provider_unavailable');
}

async function loadSectionPersistence() {
  const module = await import('./music-section-regeneration-persistence.mjs');
  if (typeof module.persistSectionRegeneration !== 'function') throw new Error('section_persistence_unavailable');
  return module.persistSectionRegeneration;
}

function blocked(reason, extra = {}) {
  return Object.freeze({ ok: false, schema: REVIEWED_MUSIC_GENERATION_SCHEMA, reason, ...extra });
}
