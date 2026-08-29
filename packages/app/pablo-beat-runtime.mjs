import { getProject, listProjects, saveProject } from './storage.mjs';
import { applyPabloBeatOperation } from './pablo-beat-operations.mjs';

export async function executePersistedPabloBeatOperation(operation = {}, context = {}) {
  const projectId = String(context?.projectId || '');
  let project = projectId ? await getProject(projectId) : null;
  if (projectId && !project) {
    return {
      ok: false,
      mutated: false,
      reason: 'project_not_found',
      reply: 'Não consegui confirmar o projeto ativo para alterar o Beat Lab. Não mexi em outro projeto como fallback.',
    };
  }
  if (!project) project = (await listProjects())[0] || null;

  const result = await applyPabloBeatOperation(project, operation);
  if (result?.ok && result?.requiresAudioRender === true && result?.timelineRender) {
    const renderer = await loadTimelineRenderer();
    if (!renderer) {
      return {
        ...result,
        ok: false,
        mutated: false,
        reason: 'timeline_render_runtime_unavailable',
        reply: 'O plano da virada está pronto, mas o renderizador de timeline não está disponível nesta versão. Não alterei o projeto.',
      };
    }
    const rendered = await renderer.renderPabloBeatTimeline(project, result.timelineRender);
    return {
      ...result,
      ...rendered,
      action: result.action || rendered?.action || operation?.action || null,
      timelineRender: result.timelineRender,
      targetSection: result.targetSection || null,
      data: {
        ...(result.data || {}),
        ...(rendered?.data || {}),
        projectId: rendered?.project?.id || rendered?.data?.projectId || projectId || null,
      },
    };
  }
  if (!result?.ok || !result?.mutated || !result?.project) return result;

  const saved = await saveProject(result.project);
  return {
    ...result,
    project: saved,
    data: {
      ...(result.data || {}),
      projectId: saved?.id || result.data?.projectId || projectId || null,
    },
  };
}

async function loadTimelineRenderer() {
  try {
    const module = await import('./beat-timeline-runtime.mjs');
    if (typeof module.renderPabloBeatTimeline === 'function') return module;
  } catch {
    // Fail closed: conversational planning must never pretend a render happened.
  }
  return null;
}
