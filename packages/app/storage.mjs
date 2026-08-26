import { migrateProject } from './core/src/project.mjs';

const DB_NAME = 'pablovoice_mobile_v2';
const DB_VERSION = 3;
let openPromise;

export function openDatabase() {
  if (openPromise) return openPromise;
  openPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('audio')) database.createObjectStore('audio', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { openPromise = null; reject(request.error); };
    request.onblocked = () => reject(new Error('Feche outra aba do PabloVoice para atualizar o banco local.'));
  });
  return openPromise;
}

export async function saveProject(project) {
  const clean = migrateProject(project);
  await put('projects', clean);
  return clean;
}

export async function getProject(id) {
  const raw = await get('projects', id);
  if (!raw) return null;
  const project = migrateProject(raw);
  if (!project.tracks.length && raw.audioId) project.legacyAudioId = raw.audioId;
  if (raw.settings) project.legacySettings = raw.settings;
  return project;
}

export async function listProjects() {
  const values = await all('projects');
  return values.map((raw) => {
    const project = migrateProject(raw);
    if (!project.tracks.length && raw.audioId) project.legacyAudioId = raw.audioId;
    if (raw.settings) project.legacySettings = raw.settings;
    return project;
  }).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id) {
  const project = await getProject(id);
  const assetIds = new Set((project?.tracks || []).map((track) => track.assetId).filter(Boolean));
  if (project?.legacyAudioId) assetIds.add(project.legacyAudioId);
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(['projects', 'audio'], 'readwrite');
    transaction.objectStore('projects').delete(id);
    for (const assetId of assetIds) transaction.objectStore('audio').delete(assetId);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Exclusão cancelada.'));
  });
}

export async function saveAudioAsset({ id, blob, name, type, createdAt = Date.now() }) {
  if (!(blob instanceof Blob) || blob.size === 0) throw new TypeError('Arquivo de áudio vazio.');
  const value = { id, blob, name: String(name || 'áudio'), type: type || blob.type || 'application/octet-stream', createdAt };
  await put('audio', value);
  return value;
}

export function getAudioAsset(id) {
  return get('audio', id);
}

export async function saveSetting(key, value) {
  await put('settings', { key, value });
}

export async function getSetting(key, fallback = null) {
  return (await get('settings', key))?.value ?? fallback;
}

async function put(store, value) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readwrite');
    transaction.objectStore(store).put(value);
    transaction.oncomplete = () => resolve(value);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Operação local cancelada.'));
  });
}

async function get(store, id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, 'readonly').objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function all(store) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(store, 'readonly').objectStore(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

