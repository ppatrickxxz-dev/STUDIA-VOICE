import { getProject, saveProject } from './storage.mjs';
import { attachMasterVocalPerformance, ensureSongModelV3, songModelReadiness } from './song-model-v3.mjs';

let installed = false;

export function installSongModelRuntime() {
  if (installed) return;
  installed = true;
  document.addEventListener('pablovoice:stems-imported', onStemsImported);
  document.addEventListener('pablovoice:project-updated', onProjectUpdated);
}

async function onStemsImported(event) {
  const detail = event.detail || {};
  if (!detail.projectId) return;
  const project = await getProject(detail.projectId);
  if (!project) return;
  const imported = Array.isArray(detail.imported) ? detail.imported : [];
  const vocal = imported.find((item) => /guide_vocal|vocal/.test(String(item?.kind || '')));
  if (!vocal?.trackId) return;

  attachMasterVocalPerformance(project, {
    sourceTakeId: project.songCreation?.latestTakeId || null,
    guideTrackId: vocal.trackId,
    source: 'separated_native_sung_vocal',
    performance: {
      representation: 'audio_stem',
      trackId: vocal.trackId,
      symbolicAnalysis: 'pending',
      preservesRenderedPerformance: true,
    },
  });
  const saved = await saveProject(project);
  document.dispatchEvent(new CustomEvent('pablovoice:song-model-updated', {
    detail: { projectId: saved.id, reason: 'master_vocal_performance_ready', readiness: songModelReadiness(saved) },
  }));
}

async function onProjectUpdated(event) {
  const projectId = event.detail?.projectId;
  if (!projectId) return;
  const project = await getProject(projectId).catch(() => null);
  if (!project) return;
  const beforeSchema = project.songModel?.schema || null;
  ensureSongModelV3(project);
  if (beforeSchema !== project.songModel?.schema) await saveProject(project);
}

installSongModelRuntime();