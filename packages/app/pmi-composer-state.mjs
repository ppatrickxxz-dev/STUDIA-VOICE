const COMPOSER_STATE_PREFIX = 'pablovoice.composer.pending.v1:';
const MAX_DRAFT_CHARS = 12000;
const MAX_META_CHARS = 160;

export function composerStateKey(projectId = '') {
  const id = normalizeProjectId(projectId);
  return id ? `${COMPOSER_STATE_PREFIX}${id}` : null;
}

export function normalizePmiComposerState(value = {}, currentLyrics = '') {
  const text = normalizeText(value?.text, MAX_DRAFT_CHARS);
  const version = normalizeVersion(value?.version ?? value?.draftVersion);
  if (!text || !version) return null;
  const baseLyrics = String(value?.baseLyrics ?? '').slice(0, MAX_DRAFT_CHARS);
  if (baseLyrics !== String(currentLyrics || '').slice(0, MAX_DRAFT_CHARS)) return null;
  return Object.freeze({
    text,
    version,
    command: normalizeOptional(value?.command, 64),
    targetSection: normalizeOptional(value?.targetSection, 64),
    targetGenre: normalizeOptional(value?.targetGenre, 64),
    baseLyrics,
    provider: normalizeOptional(value?.provider, MAX_META_CHARS),
    model: normalizeOptional(value?.model, MAX_META_CHARS),
    savedAt: normalizeTimestamp(value?.savedAt),
  });
}

export async function loadPmiComposerState(projectId = '', currentLyrics = '', { read = defaultReadSetting, write = defaultWriteSetting } = {}) {
  const key = composerStateKey(projectId);
  if (!key) return null;
  const raw = await read(key, null);
  const normalized = normalizePmiComposerState(raw, currentLyrics);
  if (!normalized && raw != null) await write(key, null);
  return normalized;
}

export async function savePmiComposerState(projectId = '', value = {}, { write = defaultWriteSetting } = {}) {
  const key = composerStateKey(projectId);
  if (!key) return null;
  const baseLyrics = String(value?.baseLyrics ?? '').slice(0, MAX_DRAFT_CHARS);
  const normalized = normalizePmiComposerState({ ...value, savedAt: Date.now() }, baseLyrics);
  if (!normalized) throw new TypeError('Estado pendente do Composer inválido.');
  await write(key, normalized);
  return normalized;
}

export async function clearPmiComposerState(projectId = '', { write = defaultWriteSetting } = {}) {
  const key = composerStateKey(projectId);
  if (!key) return false;
  await write(key, null);
  return true;
}

export function applyConfirmedPmiDraft(project, confirmation = {}, snapshot) {
  if (!project?.id) throw new TypeError('Projeto inválido para aplicar rascunho.');
  if (typeof snapshot !== 'function') throw new TypeError('Snapshot canônico é obrigatório para aplicar rascunho.');
  const mode = confirmation?.mode === 'append' || confirmation?.mode === 'replace' ? confirmation.mode : null;
  const text = normalizeText(confirmation?.text, MAX_DRAFT_CHARS);
  const draftVersion = normalizeVersion(confirmation?.draftVersion);
  if (!mode || !text || !draftVersion) throw new TypeError('Confirmação de rascunho inválida.');

  const next = structuredClone(project);
  const current = String(next.lyrics || '').trimEnd();
  next.lyrics = mode === 'append' && current ? `${current}\n\n${text}` : text;
  const label = mode === 'append' ? 'Rascunho PMI adicionado à letra' : 'Rascunho PMI usado como letra';
  return snapshot(next, label);
}

async function defaultReadSetting(key, fallback = null) {
  const { getSetting } = await import('./storage.mjs');
  return getSetting(key, fallback);
}

async function defaultWriteSetting(key, value) {
  const { saveSetting } = await import('./storage.mjs');
  return saveSetting(key, value);
}

function normalizeProjectId(value) {
  return String(value || '').trim().slice(0, MAX_META_CHARS);
}

function normalizeText(value, limit) {
  return String(value || '').trim().slice(0, limit);
}

function normalizeOptional(value, limit) {
  const text = String(value || '').trim().slice(0, limit);
  return text || null;
}

function normalizeVersion(value) {
  const version = Math.floor(Number(value));
  return Number.isFinite(version) && version >= 1 && version <= 99 ? version : null;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now();
}
