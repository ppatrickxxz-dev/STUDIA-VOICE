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

export async function applyPabloBeatOperation(project, operation = {}) {
  if (!project || typeof project !== 'object') return blocked('project_required', 'Crie ou abra um projeto primeiro.');
  const sampler = normalizeSamplerState(project.sampler || {});
  if (!sampler.pads.length) return blocked('sampler_required', 'Crie pads no Sampler primeiro. O Pablo não inventou sons fora do seu projeto.');

  const action = String(operation.action || '');
  if (action === 'fill_before_section') {
    return blocked(
      'section_mapping_required',
      'Eu consigo criar uma virada no fim do padrão atual, mas ainda não consigo posicioná-la antes do refrão sem um mapa de seções ligado ao Beat Lab. Não alterei o projeto.',
      { action },
    );
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

function blocked(reason, reply, extra = {}) {
  return { ok: false, mutated: false, reason, reply, ...extra };
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
