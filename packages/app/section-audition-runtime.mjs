import { PabloAudioEngine } from './audio-engine.mjs';
import { getAudioAsset } from './storage.mjs';

const engine = new PabloAudioEngine();
const decodedAssetByTrack = new Map();
let status = Object.freeze({ playing: false, projectId: null, sectionId: null, position: 0, startSeconds: null, endSeconds: null });

export async function auditionConfirmedSection(project, section, { mode = 'processed' } = {}) {
  const projectId = String(project?.id || '');
  const sectionId = String(section?.id || '');
  const startSeconds = Number(section?.startSeconds);
  const endSeconds = Number(section?.endSeconds);
  if (!projectId || !sectionId || !Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || endSeconds <= startSeconds) {
    throw new TypeError('A seção precisa ter início e fim confirmados antes da audição.');
  }

  await ensureProjectBuffers(project);
  engine.stop(false);
  status = freezeStatus({ playing: true, projectId, sectionId, position: startSeconds, startSeconds, endSeconds });
  await engine.play(project, {
    position: startSeconds,
    mode,
    onTime: (position) => {
      if (!status.playing || status.projectId !== projectId || status.sectionId !== sectionId) return;
      status = freezeStatus({ ...status, position });
      if (position >= endSeconds - 0.015) {
        engine.stop(false);
        status = freezeStatus({ ...status, playing: false, position: endSeconds });
      }
    },
    onEnded: () => {
      if (status.projectId === projectId && status.sectionId === sectionId) {
        status = freezeStatus({ ...status, playing: false, position: endSeconds });
      }
    },
  });
  return { ok: true, projectId, sectionId, startSeconds, endSeconds, mode };
}

export function stopSectionAudition() {
  engine.stop(false);
  status = freezeStatus({ ...status, playing: false });
  return getSectionAuditionStatus();
}

export function getSectionAuditionStatus() {
  return { ...status };
}

async function ensureProjectBuffers(project) {
  let decoded = 0;
  for (const track of project?.tracks || []) {
    if (!track?.id || !track?.assetId) continue;
    if (decodedAssetByTrack.get(track.id) === track.assetId && engine.getBuffer(track.id)) {
      decoded += 1;
      continue;
    }
    const asset = await getAudioAsset(track.assetId);
    if (!asset?.blob) continue;
    await engine.decode(track.id, asset.blob);
    decodedAssetByTrack.set(track.id, track.assetId);
    decoded += 1;
  }
  if (!decoded) throw new Error('Nenhuma faixa audível foi carregada para tocar essa seção.');
}

function freezeStatus(value) {
  return Object.freeze({
    playing: Boolean(value.playing),
    projectId: value.projectId || null,
    sectionId: value.sectionId || null,
    position: Number(value.position || 0),
    startSeconds: value.startSeconds == null ? null : Number(value.startSeconds),
    endSeconds: value.endSeconds == null ? null : Number(value.endSeconds),
  });
}
