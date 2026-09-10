import { createProject } from './core/src/project.mjs';
import { activeProjectSessionId, getProject, rememberActiveProject, saveProject } from './storage.mjs';

const runtime = { observer: null, queued: false, creatingProject: false };

export function installPabloVoiceProductActions() {
  if (runtime.observer) return;
  runtime.observer = new MutationObserver(queueSync);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('click', onClick, true);
  queueSync();
}

function queueSync() {
  if (runtime.queued) return;
  runtime.queued = true;
  queueMicrotask(() => {
    runtime.queued = false;
    const home = document.querySelector('#pv-product-home');
    if (!home || home.querySelector('[data-pv-product-utilities]')) return;
    const createCard = home.querySelector('.pv-product-create-card');
    if (!createCard) return;
    const tools = document.createElement('div');
    tools.className = 'pv-product-utilities';
    tools.dataset.pvProductUtilities = 'true';
    tools.innerHTML = `<button type="button" data-action="new-project"><span>＋</span><b>Novo projeto</b></button>
      <button type="button" data-action="import"><span>↥</span><b>Importar áudio</b></button>
      <button type="button" data-action="record"><span>●</span><b>Gravar voz</b></button>
      <button type="button" data-route="projects"><span>▤</span><b>Meus projetos</b></button>`;
    createCard.insertAdjacentElement('afterend', tools);
  });
}

async function onClick(event) {
  const trigger = event.target.closest('[data-pv-product-create]');
  if (!trigger || runtime.creatingProject) return;

  const activeId = activeProjectSessionId();
  if (activeId && await getProject(activeId).catch(() => null)) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  runtime.creatingProject = true;
  const original = trigger.innerHTML;
  trigger.disabled = true;
  trigger.innerHTML = '<span>✦</span><b>Preparando projeto…</b><small>sem interromper sua ideia</small>';
  try {
    const prompt = document.querySelector('[data-pv-product-prompt]')?.value?.trim() || '';
    const project = createProject(projectName(prompt));
    const saved = await saveProject(project);
    rememberActiveProject(saved.id);
    document.dispatchEvent(new CustomEvent('pablovoice:project-updated', { detail: { projectId: saved.id, source: 'product_create_entry' } }));
    const route = [...document.querySelectorAll('[data-route="compose"]')].find((node) => !node.closest('#pv-product-home'));
    if (route) route.click();
    else location.hash = '#/compose';
  } catch (error) {
    console.error('PABLOVOICE_PRODUCT_PROJECT_BOOTSTRAP_FAILED', error);
    trigger.innerHTML = '<span>!</span><b>Não consegui abrir o projeto</b><small>Tente “Novo projeto”</small>';
    setTimeout(() => { trigger.innerHTML = original; }, 2400);
  } finally {
    runtime.creatingProject = false;
    trigger.disabled = false;
  }
}

function projectName(prompt) {
  const clean = String(prompt || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Nova música';
  const first = clean.split(/[.;:\n]/)[0].trim();
  const short = (first || clean).slice(0, 54).trim();
  return short || 'Nova música';
}

installPabloVoiceProductActions();
