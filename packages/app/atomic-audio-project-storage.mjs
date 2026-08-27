import { openDatabase } from './storage.mjs';

export async function saveProjectWithAudioAsset({ project, asset, deleteAssetIds = [] } = {}) {
  if (!project?.id) throw new TypeError('Projeto inválido para persistência atômica.');
  if (!asset?.id || !(asset.blob instanceof Blob) || asset.blob.size === 0) {
    throw new TypeError('Áudio renderizado inválido para persistência atômica.');
  }

  const audioValue = {
    id: String(asset.id),
    blob: asset.blob,
    name: String(asset.name || 'áudio'),
    type: asset.type || asset.blob.type || 'audio/wav',
    createdAt: Number(asset.createdAt) || Date.now(),
  };
  const staleIds = [...new Set((deleteAssetIds || []).map(String).filter((id) => id && id !== audioValue.id))];
  const database = await openDatabase();

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(['projects', 'audio'], 'readwrite');
    transaction.objectStore('audio').put(audioValue);
    transaction.objectStore('projects').put(project);
    for (const id of staleIds) transaction.objectStore('audio').delete(id);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Persistência atômica cancelada.'));
  });

  return { project, asset: audioValue, deletedAssetIds: staleIds };
}
