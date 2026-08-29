const draftApplyState = new Map();

export function registerPmiDraftPreview(projectId = '', draft = {}) {
  const key = normalizeProjectId(projectId);
  const text = normalizeDraftText(draft.text);
  const draftVersion = normalizeDraftVersion(draft.draftVersion);
  if (!key || !text || !draftVersion) return null;

  const state = Object.freeze({
    text,
    draftVersion,
    confirmation: null,
  });
  draftApplyState.set(key, state);
  return state;
}

export function confirmPmiDraftApply(projectId = '', confirmation = {}) {
  const key = normalizeProjectId(projectId);
  const state = key ? draftApplyState.get(key) : null;
  const mode = normalizeMode(confirmation.mode);
  const draftVersion = normalizeDraftVersion(confirmation.draftVersion);
  const text = normalizeDraftText(confirmation.text);
  if (!state || !mode || !draftVersion || !text) return null;
  if (state.draftVersion !== draftVersion || state.text !== text) return null;

  const accepted = Object.freeze({ mode, draftVersion, text });
  draftApplyState.set(key, Object.freeze({ ...state, confirmation: accepted }));
  return accepted;
}

export function getPmiDraftApplyConfirmation(projectId = '', expected = {}) {
  const key = normalizeProjectId(projectId);
  const state = key ? draftApplyState.get(key) : null;
  const draftVersion = normalizeDraftVersion(expected.draftVersion);
  const text = normalizeDraftText(expected.text);
  if (!state?.confirmation || !draftVersion || !text) return null;
  if (state.draftVersion !== draftVersion || state.text !== text) return null;
  if (state.confirmation.draftVersion !== draftVersion || state.confirmation.text !== text) return null;
  return state.confirmation;
}

export function clearPmiDraftApplyState(projectId = '') {
  const key = normalizeProjectId(projectId);
  return key ? draftApplyState.delete(key) : false;
}

function normalizeProjectId(value) {
  return String(value || '').trim().slice(0, 160);
}

function normalizeDraftText(value) {
  return String(value || '').trim().slice(0, 12000);
}

function normalizeDraftVersion(value) {
  const version = Math.floor(Number(value));
  return Number.isFinite(version) && version >= 1 && version <= 99 ? version : null;
}

function normalizeMode(value) {
  return value === 'replace' || value === 'append' ? value : null;
}
