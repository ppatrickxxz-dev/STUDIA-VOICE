import { normalizeSamplerState } from './sampler-engine.mjs';
import {
  activeBeatStepCount,
  createBeatLabState,
  generateBeatFill,
  normalizeBeatLabState,
  refreshBeatLanesFromSampler,
  setBeatGrooveAmount,
  setBeatHumanize,
} from './beat-lab-engine.mjs';
import { buildBeatFillPlan, placeFillBeforeSection } from './beat-fill-plan.mjs';

export async function applyPabloBeatOperation(project, operation = {}) {
  if (!project || typeof project !== 'object') return blocked('project_required', 'Crie ou abra um projeto primeiro.');
  const action = String(operation.action || '');

  if (action === 'mark_section') {
    const sections = await loadSectionMapRuntime();
    if (!sections) return blocked('section_map_runtime_unavailable', 'O mapa de seções não está disponível nesta versão. Não alterei o projeto.', { action });
    const startSeconds = Number(operation.args?.startSeconds);
    const endSeconds = operation.args?.endSeconds == null ? null : Number(operation.args.endSeconds);
    if (!Number.isFinite(startSeconds) || startSeconds < 0 || startSeconds > 14400) {
      return blocked('invalid_section_time', 'O tempo informado para a seção não é válido. Não alterei o projeto.', { action });
    }
    if (endSeconds != null && (!Number.isFinite(endSeconds) || endSeconds <= startSeconds || endSeconds > 14400)) {
      return blocked('invalid_section_range', 'O intervalo informado para a seção não é válido. Não alterei o projeto.', { action });
    }
    const kind = sections.normalizeSectionKind(operation.args?.section);
    if (!kind) return blocked('invalid_section_kind', 'Não reconheci essa seção musical. Não alterei o projeto.', { action });
    const next = structuredClone(project);
    next.arrangementMap = sections.upsertConfirmedSection(next.arrangementMap, {
      kind,
      startSeconds,
      endSeconds,
      source: 'user_manual',
      confidence: 1,
    });
    const label = sections.sectionLabel(kind);
    const saved = await snapshotProjectCompat(next, `${label} marcado na timeline`);
    return {
      ok: true,
      mutated: true,
      project: saved,
      action,
      reply: `${label} marcado em ${formatSeconds(startSeconds)} como timing manual confirmado.`,
      data: {
        projectId: saved.id,
        section: kind,
        sectionLabel: label,
        startSeconds,
        endSeconds,
        source: 'user_manual',
        confidence: 1,
      },
    };
  }

  const sampler = normalizeSamplerState(project.sampler || {});
  if (!sampler.pads.length) return blocked('sampler_required', 'Crie pads no Sampler primeiro. O Pablo não inventou sons fora do seu projeto.');

  if (action === 'fill_before_section') {
    const sections = await loadSectionMapRuntime();
    const target = sections?.findConfirmedSection?.(project.arrangementMap, operation.args?.section || 'chorus', {
      occurrence: operation.args?.occurrence || 1,
    });
    if (!target) {
      return blocked(
        'section_mapping_required',
        'Eu consigo criar uma virada no fim do padrão atual, mas ainda não consigo posicioná-la antes do refrão sem um timing de seção confirmado. Você pode dizer, por exemplo, “marca o refrão em 45 segundos”. Não alterei o projeto.',
        { action },
      );
    }

    const preferredBpm = project.instrumentLab?.bpm || sampler.grooveTemplate?.bpm || 120;
    const beat = project.beatLab
      ? normalizeBeatLabState(project.beatLab, sampler)
      : createBeatLabState(sampler, { bpm: preferredBpm });
    const intensity = clamp(Number(operation.args?.intensity ?? 0.65), 0, 1);
    const fillPlan = buildBeatFillPlan(beat, { intensity });
    if (!fillPlan.ok) {
      const reason = fillPlan.reason === 'no_percussive_lane' ? 'no_percussive_lane' : 'fill_plan_unavailable';
      return blocked(
        reason,
        reason === 'no_percussive_lane'
          ? 'Ainda não há uma lane percussiva adequada para eu criar uma virada antes dessa seção. Não alterei o projeto.'
          : 'Não consegui montar uma virada segura com o padrão atual. Mantive o projeto intacto.',
        { action, targetSection: target },
      );
    }
    const placement = placeFillBeforeSection(fillPlan, target);
    if (!placement.ok) {
      return blocked(
        placement.reason || 'timeline_placement_unavailable',
        placement.reason === 'insufficient_lead_time'
          ? `${target.label} começa cedo demais para caber a virada gerada sem atravessar o início da seção. Não alterei o projeto.`
          : 'Não consegui confirmar uma janela segura para a virada. Mantive o projeto intacto.',
        { action, targetSection: target },
      );
    }

    return {
      ok: true,
      mutated: false,
      action,
      requiresAudioRender: true,
      timelineRender: placement,
      targetSection: target,
      reply: `A virada está planejada para terminar exatamente no início de ${target.label}, em ${formatSeconds(target.startSeconds)}.`,
      data: {
        projectId: project.id,
        targetSectionId: target.id,
        targetStartSeconds: target.startSeconds,
        fillStartSeconds: placement.startSeconds,
        fillDurationSeconds: placement.durationSeconds,
        intensity,
      },
    };
  }
  if (action === 'genre_pattern') {
    return blocked(
      'genre_pattern_preview_only',
      `Entendi o pedido de bateria ${String(operation.args?.genre || 'por gênero')}, mas a biblioteca de padrões por gênero ainda não passou pelo gate musical. Não apliquei um padrão genérico fingindo que era específico.`,
      { action, genre: String(operation.args?.genre || '') || null },
    );
  }

  const preferredBpm = project.instrumentLab?.bpm || sampler.grooveTemplate?.bpm || 120;
  let beat = project.beatLab
    ? normalizeBeatLabState(project.beatLab, sampler)
    : createBeatLabState(sampler, { bpm: preferredBpm });
  let label = 'Beat Lab ajustado pelo Pablo';
  let reply = 'Atualizei o Beat Lab e salvei uma revisão reversível.';

  if (action === 'organize') {
    beat = refreshBeatLanesFromSampler(beat, sampler);
    label = 'Beat Lab organizado pelo Pablo';
    reply = 'Organizei os sons pelas funções acústicas mais prováveis, preservando os passos ligados aos mesmos pads.';
  } else if (action === 'humanize') {
    const amount = clamp(Number(operation.args?.amount ?? 0.35), 0, 1);
    beat = setBeatHumanize(beat, amount);
    label = 'Beat humanizado pelo Pablo';
    reply = `Deixei a bateria menos reta com humanização determinística em ${Math.round(amount * 100)}%.`;
  } else if (action === 'apply_groove') {
    if (!sampler.grooveTemplate?.ready) {
      return blocked('groove_evidence_unavailable', 'Não encontrei groove de referência com confiança suficiente nesse áudio. Mantive a batida intacta.', { action });
    }
    const amount = clamp(Number(operation.args?.amount ?? 0.65), 0, 1);
    beat = setBeatGrooveAmount(beat, amount);
    label = 'Groove de referência aplicado pelo Pablo';
    reply = `Apliquei ${Math.round(amount * 100)}% do groove detectado no áudio, de forma não destrutiva.`;
  } else if (action === 'fill') {
    const intensity = clamp(Number(operation.args?.intensity ?? 0.65), 0, 1);
    beat = generateBeatFill(beat, { intensity });
    if (!beat.lastOperation?.ok) {
      return blocked('no_percussive_lane', 'Ainda não há uma lane percussiva adequada para eu criar uma virada automaticamente. Não alterei o projeto.', { action });
    }
    label = 'Virada criada pelo Pablo';
    reply = 'Criei uma virada no fim do padrão atual usando uma lane percussiva existente.';
  } else {
    return blocked('unsupported_beat_operation', 'Esse comando do Beat Lab ainda não tem uma operação segura implementada.', { action });
  }

  const next = structuredClone(project);
  next.beatLab = normalizeBeatLabState(beat, sampler);
  const saved = await snapshotProjectCompat(next, label);
  return {
    ok: true,
    mutated: true,
    project: saved,
    action,
    reply,
    data: {
      projectId: saved.id,
      activeSteps: activeBeatStepCount(saved.beatLab),
      humanize: saved.beatLab.humanize,
      grooveAmount: saved.beatLab.grooveAmount,
      lanes: saved.beatLab.lanes.map((lane) => ({
        padId: lane.padId,
        category: lane.category,
        confidence: lane.categoryConfidence,
      })),
    },
  };
}

async function loadSectionMapRuntime() {
  for (const specifier of ['./core/src/section-map.mjs', '../core/src/section-map.mjs']) {
    try {
      const module = await import(specifier);
      if (typeof module.normalizeArrangementMap === 'function') return module;
    } catch {
      // Packaged runtime and source tests place the canonical core package at different roots.
    }
  }
  return null;
}

async function snapshotProjectCompat(project, label) {
  for (const specifier of ['./core/src/project.mjs', '../core/src/project.mjs']) {
    try {
      const module = await import(specifier);
      if (typeof module.snapshotProject === 'function') return module.snapshotProject(project, label);
    } catch {
      // Packaged runtime and source tests place the canonical core package at different roots.
    }
  }
  throw new Error('Canonical project snapshot runtime is unavailable.');
}

function formatSeconds(value) {
  const total = Math.max(0, Number(value) || 0);
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  if (!minutes) return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
  const rendered = seconds.toFixed(seconds % 1 ? 1 : 0).padStart(seconds % 1 ? 4 : 2, '0');
  return `${minutes}:${rendered}`;
}

function blocked(reason, reply, extra = {}) {
  return { ok: false, mutated: false, reason, reply, ...extra };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
