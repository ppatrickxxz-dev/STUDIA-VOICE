import { saveAudioAsset, saveProject } from './storage.mjs';
import { MUSIC_SECTION_REGEN_SCHEMA } from './music-section-regeneration.mjs';

let projectCorePromise = null;

export async function persistSectionRegeneration(project, plan, result, {
  saveAudio = saveAudioAsset,
  save = saveProject,
} = {}) {
  if (!project?.id) throw new TypeError('Projeto inválido para salvar regeneração por seção.');
  if (!plan?.ok || !plan?.section?.id) throw new TypeError('Plano de regeneração por seção inválido.');
  if (!result?.ok || !(result.blob instanceof Blob) || result.blob.size <= 0) throw new TypeError('Áudio regenerado inválido.');

  const { createId, createTrack, snapshotProject } = await loadProjectCore();
  const sourceTake = (project.songCreation?.takes || []).find((take) => take.id === plan.sourceTakeId);
  if (!sourceTake) throw new Error('Take de origem não encontrado. Nenhuma versão foi salva.');

  const takeId = createId('songtake');
  const takeNumber = Math.max(1, Number(project.songCreation?.takes?.length || 0) + 1);
  const assetId = createId('asset');
  const safeLabel = String(plan.section.label || 'Seção').trim().slice(0, 80) || 'Seção';
  const extension = String(result.type || '').includes('mpeg') ? 'mp3' : 'audio';
  await saveAudio({
    id: assetId,
    blob: result.blob,
    name: `Demo IA HQ · ${safeLabel} v${takeNumber}.${extension}`,
    type: result.type || 'audio/mpeg',
  });

  const track = createTrack({
    name: `Demo IA HQ · ${safeLabel} v${takeNumber}`,
    assetId,
    type: result.type || 'audio/mpeg',
    duration: Number(sourceTake.durationSeconds) || Number(plan.durationMs) / 1000,
    sampleRate: 48000,
    channels: 2,
    kind: 'ai_music_demo',
  });
  Object.assign(track, {
    role: 'reference_mix',
    songTakeId: takeId,
    source: 'elevenmusic_music_v2_inpainting',
    provider: result.provider || 'elevenmusic',
    providerModel: result.model || 'music_v2',
    providerSongId: result.songId || null,
    requestId: result.requestId || null,
    derivedFromTrackId: sourceTake.referenceTrackId || null,
  });

  const next = structuredClone(project);
  next.tracks = [...(next.tracks || []), track];
  next.activeTrackId = track.id;
  const regeneration = Object.freeze({
    schema: MUSIC_SECTION_REGEN_SCHEMA,
    sourceTakeId: plan.sourceTakeId,
    sourceSongId: plan.sourceSongId,
    sectionId: plan.section.id,
    sectionLabel: safeLabel,
    startMs: plan.section.startMs,
    endMs: plan.section.endMs,
    replacementText: plan.section.text,
    positiveStyles: [...(plan.section.positiveStyles || [])],
    negativeStyles: [...(plan.section.negativeStyles || [])],
    contextAdherence: plan.section.contextAdherence || 'high',
  });
  const newTake = {
    ...structuredClone(sourceTake),
    id: takeId,
    createdAt: Date.now(),
    derivedFromTakeId: plan.sourceTakeId,
    providerSongId: result.songId || null,
    referenceTrackId: track.id,
    remoteProjectId: result.remoteProjectId || sourceTake.remoteProjectId || null,
    regeneration,
    render: {
      ...(structuredClone(sourceTake.render || {})),
      provider: result.provider || 'elevenmusic',
      model: result.model || 'music_v2',
      requestId: result.requestId || null,
      format: result.type || 'audio/mpeg',
      purpose: 'section_regenerated_reference_mix',
    },
  };
  const takes = [...(next.songCreation?.takes || []), newTake].slice(-12);
  next.songCreation = {
    ...(next.songCreation || {}),
    latestTakeId: takeId,
    takes,
  };

  const snapshotted = snapshotProject(next, `${safeLabel} regenerado · Take ${takeNumber}`);
  const saved = await save(snapshotted);
  return Object.freeze({
    project: saved,
    take: newTake,
    track,
    takeNumber,
    assetId,
  });
}

async function loadProjectCore() {
  if (!projectCorePromise) {
    projectCorePromise = (async () => {
      for (const specifier of ['./core/src/project.mjs', '../core/src/project.mjs']) {
        try {
          const module = await import(specifier);
          if (
            typeof module.createId === 'function'
            && typeof module.createTrack === 'function'
            && typeof module.snapshotProject === 'function'
          ) return module;
        } catch {
          // The packaged app and source-level tests expose Project Core at different relative paths.
        }
      }
      throw new Error('project_core_unavailable');
    })();
  }
  return projectCorePromise;
}
