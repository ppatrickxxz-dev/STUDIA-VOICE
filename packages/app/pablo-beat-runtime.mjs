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
