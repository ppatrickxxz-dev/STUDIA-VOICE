import { migrateProject } from '../core/src/project.mjs';
import { sortProjectsByContext } from './project-context.mjs';

const DB_NAME = 'pablovoice_mobile_v2';
const DB_VERSION = 3;
const ACTIVE_PROJECT_SESSION_KEY = 'pablovoice.activeProjectId';
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

export function rememberActiveProject(id) {
  if (!id) return;
  try { globalThis.sessionStorage?.setItem(ACTIVE_PROJECT_SESSION_KEY, String(id)); }
  catch { /* session storage can be unavailable in privacy/file contexts */ }
}

export function activeProjectSessionId() {
  try { return globalThis.sessionStorage?.getItem(ACTIVE_PROJECT_SESSION_KEY) || null; }
  catch { return null; }
}

export { sortProjectsByContext } from './project-context.mjs';

export async function saveProject(project) {
  const clean = migrateProject(project);
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').put(clean);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Falha ao salvar projeto.'));
  });
  rememberActiveProject(clean.id);
  return clean;
}

export async function loadProject(id) {
  const db = await openDatabase();
  const raw = await new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const request = tx.objectStore('projects').get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  if (!raw) return null;
  const clean = migrateProject(raw);
  rememberActiveProject(clean.id);
  return clean;
}

export async function deleteProject(id) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readwrite');
    tx.objectStore('projects').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Falha ao excluir projeto.'));
  });
}

export async function listProjects() {
  const db = await openDatabase();
  const rows = await new Promise((resolve, reject) => {
    const tx = db.transaction('projects', 'readonly');
    const request = tx.objectStore('projects').getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  return sortProjectsByContext(rows.map(migrateProject), { activeProjectId: activeProjectSessionId() });
}

export async function saveAudioAsset({ id, blob, name, type }) {
  if (!id || !(blob instanceof Blob)) throw new TypeError('Áudio inválido para salvar.');
  const db = await openDatabase();
  const record = { id, blob, name: name || 'audio', type: type || blob.type || 'audio/wav', updatedAt: Date.now() };
  await new Promise((resolve, reject) => {
    const tx = db.transaction('audio', 'readwrite');
    tx.objectStore('audio').put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Falha ao salvar áudio.'));
  });
  return record;
}

export async function loadAudioAsset(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audio', 'readonly');
    const request = tx.objectStore('audio').get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteAudioAsset(id) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('audio', 'readwrite');
    tx.objectStore('audio').delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Falha ao excluir áudio.'));
  });
}

export async function saveSetting(key, value) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key, value, updatedAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Falha ao salvar configuração.'));
  });
}

export async function loadSetting(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readonly');
    const request = tx.objectStore('settings').get(key);
    request.onsuccess = () => resolve(request.result?.value ?? null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteSetting(key) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Falha ao excluir configuração.'));
  });
}
