import { getProject, listProjects, saveProject } from './storage.mjs';
import { applyPabloBeatOperation } from './pablo-beat-operations.mjs';

export async function executePersistedPabloBeatOperation(operation = {}, context = {}) {
  const projectId = String(context?.projectId || '');
  let project = projectId ? await getProject(projectId) : null;
  if (!project) project = (await listProjects())[0] || null;

  const result = applyPabloBeatOperation(project, operation);
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
