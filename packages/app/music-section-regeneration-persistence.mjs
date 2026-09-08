import { createId, createTrack, snapshotProject } from './core/src/project.mjs';
import { saveAudioAsset, saveProject } from './storage.mjs';
import { MUSIC_SECTION_REGEN_SCHEMA } from './music-section-regeneration.mjs';

export async function persistSectionRegeneration(project, plan, result, {
  saveAudio = saveAudioAsset,
  save = saveProject,
} = {}) {
  if (!project?.id) throw new TypeError('Projeto inválido para salvar regeneração por seção.');
  if (!plan?.ok || !plan?.section?.id) throw new TypeError('Plano de regeneração por seção inválido.');
  if (!result?.ok || !(result.blob instanceof Blob) || result.blob.size <= 0) throw new TypeError('Áudio regenerado inválido.');

  const sourceTake = (project.songCreation?.takes || []).find((take) => take.id === plan.sourceTakeId);
  if (!sourceTake) throw new Error('Take de origem não encontrado. Nenhuma versão foi salva.');

  const takeId = createId('songtake');
  const takeNumber = Math.max(1, Number(project.songCreation?.takes?.length || 0) + 1);
  const assetId = createId('asset');
  const safeLabel = String(plan.section.label || 'Seção').trim().slice(0, 80) || 'Seção';
  const remoteAsset = result.asset || {};
  const type = result.type || remoteAsset.mime_type || 'audio/flac';
  const extension = String(type).includes('flac') ? 'flac' : String(type).includes('mpeg') ? 'mp3' : 'audio';
  const duration = Number(remoteAsset.duration_seconds) || Number(sourceTake.durationSeconds) || Number(plan.durationMs) / 1000;
  const sampleRate = Number(remoteAsset.sample_rate) || Number(sourceTake.render?.sampleRate) || 48000;
  const channels = Number(remoteAsset.channels) || Number(sourceTake.render?.channels) || 2;
  const source = result.source || (plan.sourceType === 'native_asset' ? 'pablovoice_native_music_repaint_v1' : 'elevenmusic_music_v2_inpainting');
  const provider = result.provider || (plan.sourceType === 'native_asset' ? 'kaggle' : 'elevenmusic');
  const model = result.model || (plan.sourceType === 'native_asset' ? 'acestep-v15-turbo' : 'music_v2');
  const productLabel = `Versão conectada · ${safeLabel} v${takeNumber}`;

  await saveAudio({ id: assetId, blob: result.blob, name: `${productLabel}.${extension}`, type });

  const track = createTrack({
    name: productLabel,
    assetId,
    type,
    duration,
    sampleRate,
    channels,
    kind: 'ai_music_demo',
  });
  Object.assign(track, {
    role: 'reference_mix',
    songTakeId: takeId,
    source,
    provider,
    providerModel: model,
    providerModelRevision: result.modelRevision || null,
    providerSongId: result.songId || null,
    requestId: result.requestId || null,
    remoteAssetId: remoteAsset.id || result.remoteAssetId || null,
    remoteSha256: result.sha256 || remoteAsset.sha256 || null,
    derivedFromTrackId: sourceTake.referenceTrackId || null,
  });

  const next = structuredClone(project);
  next.tracks = [...(next.tracks || []), track];
  next.activeTrackId = track.id;
  const regeneration = Object.freeze({
    schema: MUSIC_SECTION_REGEN_SCHEMA,
    sourceTakeId: plan.sourceTakeId,
    sourceType: plan.sourceType || 'provider_song_id',
    sourceAssetId: plan.sourceAssetId || null,
    sourceSongId: plan.sourceSongId || null,
    sectionId: plan.section.id,
    sectionLabel: safeLabel,
    startMs: plan.section.startMs,
    endMs: plan.section.endMs,
    replacementText: plan.section.text,
    positiveStyles: [...(plan.section.positiveStyles || [])],
    negativeStyles: [...(plan.section.negativeStyles || [])],
    contextAdherence: plan.section.contextAdherence || 'high',
    outputRemoteAssetId: remoteAsset.id || result.remoteAssetId || null,
    outputSha256: result.sha256 || remoteAsset.sha256 || null,
  });
  const newTake = {
    ...structuredClone(sourceTake),
    id: takeId,
    createdAt: Date.now(),
    derivedFromTakeId: plan.sourceTakeId,
    providerSongId: result.songId || null,
    referenceTrackId: track.id,
    remoteProjectId: result.remoteProjectId || sourceTake.remoteProjectId || null,
    remoteAssetId: remoteAsset.id || result.remoteAssetId || null,
    regeneration,
    render: {
      ...(structuredClone(sourceTake.render || {})),
      provider,
      model,
      modelRevision: result.modelRevision || sourceTake.render?.modelRevision || null,
      requestId: result.requestId || null,
      sha256: result.sha256 || remoteAsset.sha256 || null,
      remoteAssetId: remoteAsset.id || result.remoteAssetId || null,
      format: type,
      sampleRate,
      channels,
      purpose: 'section_regenerated_reference_mix',
    },
  };
  const takes = [...(next.songCreation?.takes || []), newTake].slice(-12);
  next.songCreation = { ...(next.songCreation || {}), latestTakeId: takeId, takes };

  const snapshotted = snapshotProject(next, `${safeLabel} regenerado · Take ${takeNumber}`);
  const saved = await save(snapshotted);
  return Object.freeze({ project: saved, take: newTake, track, takeNumber, assetId });
}
