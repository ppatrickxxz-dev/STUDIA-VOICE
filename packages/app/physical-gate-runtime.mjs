import { PabloAudioEngine } from './audio-engine.mjs';
import { getAudioAsset, getProject, listProjects } from './storage.mjs';

const ACTIVE_PROJECT_SESSION_KEY = 'pablovoice.activeProjectId';
const PENDING_COMPOSER_KEY = 'pablovoice.pendingComposerPrompt';
const PATCH_FLAG = Symbol.for('pablovoice.physicalGatePlaybackPatched');

let observer;

export function installAudioPlaybackRecovery() {
  const proto = PabloAudioEngine?.prototype;
  if (!proto || proto[PATCH_FLAG]) return;
  const originalPlay = proto.play;
  proto.play = async function patchedPlay(project, options) {
    try {
      return await originalPlay.call(this, project, options);
    } catch (error) {
      if (!/Nenhuma faixa audível foi carregada/i.test(String(error?.message || ''))) throw error;
      const recovered = await recoverAudioBuffers(project, this);
      if (!recovered) throw error;
      return originalPlay.call(this, project, options);
    }
  };
  Object.defineProperty(proto, PATCH_FLAG, { value: true, configurable: false });
}

export function installPhysicalGateRuntime() {
  if (observer) return () => observer.disconnect();
  installActiveProjectTracking();
  installCreateMusicRouting();
  installComposerPromptBridge();
  globalThis.PabloVoiceRecoverAudioBuffers = recoverAudioBuffers;
  observer = new MutationObserver(() => {
    syncActiveProjectFromDom();
    hydrateComposerPrompt();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  syncActiveProjectFromDom();
  hydrateComposerPrompt();
  return () => {
    observer?.disconnect();
    observer = null;
    delete globalThis.PabloVoiceRecoverAudioBuffers;
  };
}

function installActiveProjectTracking() {
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action="open-project"][data-id]');
    if (!target?.dataset.id) return;
    try { sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, target.dataset.id); } catch { /* storage unavailable */ }
  }, true);
}

async function syncActiveProjectFromDom() {
  const title = document.querySelector('.pv-hero.compact .pv-title')?.textContent?.trim();
  if (!title) return;
  const projects = await listProjects().catch(() => []);
  const exact = projects.filter((project) => String(project?.name || '').trim() === title);
  const selected = exact.length === 1 ? exact[0] : exact.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
  if (!selected?.id) return;
  try { sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, selected.id); } catch { /* storage unavailable */ }
}

function installCreateMusicRouting() {
  document.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-pablo-form]');
    if (!form) return;
    const input = form.querySelector('input[name="message"]');
    const message = String(input?.value || '').trim();
    if (!isCreateMusicIntent(message)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { sessionStorage.setItem(PENDING_COMPOSER_KEY, message); } catch { /* storage unavailable */ }
    const compose = document.querySelector('[data-route="compose"]');
    if (compose) compose.click();
    else location.hash = '#/compose';
  }, true);
}

function installComposerPromptBridge() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-route="compose"]');
    if (!button) return;
    queueMicrotask(hydrateComposerPrompt);
  }, true);
}

function hydrateComposerPrompt() {
  let pending = '';
  try { pending = String(sessionStorage.getItem(PENDING_COMPOSER_KEY) || ''); } catch { /* storage unavailable */ }
  if (!pending) return;
  const task = document.querySelector('#pv-ai-composer [name="task"]');
  if (!task) return;
  if (!task.value) task.value = pending;
  try { sessionStorage.removeItem(PENDING_COMPOSER_KEY); } catch { /* storage unavailable */ }
  const panel = document.querySelector('#pv-ai-composer');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  task.focus();
}

function isCreateMusicIntent(message) {
  const text = String(message || '').toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\b(criar|cria|fazer|faz|compor|compoe|escrever|escreve|gerar|gera)\b/.test(text)
    && /\b(musica|som|faixa|letra|refrao|verso|beat|demo)\b/.test(text);
}

async function resolveActiveProject(project) {
  const directId = String(project?.id || '');
  if (directId) return project;
  let id = '';
  try { id = String(sessionStorage.getItem(ACTIVE_PROJECT_SESSION_KEY) || ''); } catch { /* storage unavailable */ }
  if (id) {
    const stored = await getProject(id).catch(() => null);
    if (stored) return stored;
  }
  const projects = await listProjects().catch(() => []);
  return projects[0] || null;
}

async function recoverAudioBuffers(project, engine) {
  const current = await resolveActiveProject(project);
  if (!current || !engine?.decode) return 0;
  let recovered = 0;
  for (const track of current.tracks || []) {
    if (!track?.id || engine.getBuffer?.(track.id)) continue;
    const asset = await getAudioAsset(track.assetId).catch(() => null);
    if (!asset?.blob) continue;
    try {
      await engine.decode(track.id, asset.blob);
      recovered += 1;
    } catch (error) {
      console.warn('PABLOVOICE_BUFFER_RECOVERY_FAILED', track.id, error);
    }
  }
  return recovered;
}

export const PHYSICAL_GATE_RUNTIME_POLICY = Object.freeze({
  createMusicRoutesToComposer: true,
  activeProjectTracking: true,
  playbackMayRehydrateIndexedDbBuffers: true,
  noSilentProjectMutation: true,
});