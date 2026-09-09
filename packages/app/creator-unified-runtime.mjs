import { RemoteAuthAdapter } from './remote-auth.mjs';

const runtime = {
  observer: null,
  queued: false,
  applying: false,
  running: false,
  auth: new RemoteAuthAdapter(),
};

export function installCreatorUnifiedRuntime() {
  if (runtime.observer) return () => disconnect();
  runtime.observer = new MutationObserver(queueSync);
  runtime.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled', 'data-pv-network-mode', 'data-pv-network-policy', 'data-pv-experience', 'data-pv-ready'],
  });
  document.addEventListener('click', onClick, true);
  window.addEventListener('online', queueSync);
  window.addEventListener('offline', queueSync);
  queueSync();
  return disconnect;
}

function disconnect() {
  runtime.observer?.disconnect();
  runtime.observer = null;
  document.removeEventListener('click', onClick, true);
  window.removeEventListener('online', queueSync);
  window.removeEventListener('offline', queueSync);
}

function queueSync() {
  if (runtime.queued) return;
  runtime.queued = true;
  queueMicrotask(() => {
    runtime.queued = false;
    syncUnifiedStudio();
  });
}

function syncUnifiedStudio() {
  if (runtime.applying) return;
  runtime.applying = true;
  try {
    const html = document.documentElement;
    setDataset(html, 'pvStudioMode', 'unified');
    setDataset(html, 'pvNetworkMode', 'adaptive');

    const health = document.querySelector('.pv-health');
    if (health) {
      setDataset(health, 'pvUnifiedHealth', 'ready');
      health.setAttribute('aria-label', 'Studio pronto');
    }
    document.querySelectorAll('[data-pv-network-copy]').forEach((node) => setDataset(node, 'pvUnifiedCopy', 'true'));
    const homeLead = document.querySelector('.pv-intimate-home-hero .pv-lead');
    if (homeLead) setDataset(homeLead, 'pvUnifiedLead', 'true');

    const form = document.querySelector('[data-song-create-form]');
    if (!form) return;
    ensureCompleteDuration(form);
    ensureUnifiedCreation(form);
  } finally {
    runtime.applying = false;
  }
}

function ensureCompleteDuration(form) {
  const duration = form.elements.duration;
  if (!(duration instanceof HTMLSelectElement)) return;
  if (!duration.querySelector('option[value="200"]')) {
    const option = document.createElement('option');
    option.value = '200';
    option.textContent = '3:20 · completa';
    duration.appendChild(option);
  }
  for (const item of duration.options) {
    if (item.value === '60' && /rascunho/i.test(item.textContent)) item.textContent = '1:00 · curta';
    if (item.value === '120' && /demo/i.test(item.textContent)) item.textContent = '2:00 · média';
  }
}

function ensureUnifiedCreation(form) {
  const local = form.querySelector('[data-song-create-button]');
  const connected = form.querySelector('[data-song-create-hq]');
  if (!local && !connected) return;

  setDataset(form, 'pvNetworkPolicy', 'adaptive_unified');
  setDataset(form, 'pvExecutionPolicy', 'best_available');

  const localCard = local?.closest('.pv-song-mode-card');
  const connectedCard = connected?.closest('.pv-song-mode-card');
  if (localCard && !localCard.hidden) localCard.hidden = true;
  if (connectedCard && !connectedCard.hidden) connectedCard.hidden = true;

  let card = form.querySelector('[data-pv-unified-create-card]');
  if (!card) {
    card = document.createElement('section');
    card.className = 'pv-song-mode-card pv-unified-create-card';
    card.dataset.pvUnifiedCreateCard = 'true';
    card.innerHTML = '<div><strong>Produzir no PabloVoice</strong><span>Um único fluxo. O Studio escolhe automaticamente o melhor executor disponível e mantém o mesmo projeto editável.</span></div><button class="pv-btn primary" type="button" data-pv-unified-create>● Produzir música</button>';
    const anchor = localCard || connectedCard || form.firstElementChild;
    if (anchor) anchor.insertAdjacentElement('beforebegin', card);
    else form.appendChild(card);
  }

  const instrumental = Boolean(form.elements.instrumentalFirst?.checked);
  const button = card.querySelector('[data-pv-unified-create]');
  if (!button) return;
  const available = Boolean((local && !local.disabled) || (connected && !connected.disabled));
  const busy = runtime.running || !available;
  if (button.disabled !== busy) button.disabled = busy;
  button.classList.toggle('busy', runtime.running);
  if (!runtime.running) setText(button, instrumental ? '● Produzir instrumental' : '● Produzir música');
}

async function onClick(event) {
  const kindButton = event.target.closest('[data-pv-kind]');
  if (kindButton) return queueMicrotask(queueSync);

  const button = event.target.closest('[data-pv-unified-create]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (runtime.running) return;

  const form = button.closest('[data-song-create-form]');
  if (!form) return;
  const local = form.querySelector('[data-song-create-button]');
  const connected = form.querySelector('[data-song-create-hq]');

  runtime.running = true;
  button.disabled = true;
  button.classList.add('busy');
  setText(button, '● Preparando produção…');

  try {
    let session = null;
    if (navigator.onLine !== false && connected && !connected.disabled) {
      session = await runtime.auth.ensureSession().catch(() => null);
    }

    if (session?.accessToken && connected && !connected.disabled) {
      connected.dataset.pvAuthBypass = '1';
      connected.click();
      return;
    }

    if (local && !local.disabled) {
      if (connected) connected.hidden = true;
      local.click();
      return;
    }

    const status = form.querySelector('#pv-song-create-status, [data-song-create-status]');
    if (status) {
      setText(status, 'Nenhum executor está pronto para esta ação agora. O projeto continua aberto e editável.');
      status.classList.add('error');
    }
  } finally {
    runtime.running = false;
    queueSync();
  }
}

function setDataset(node, key, value) {
  if (node?.dataset?.[key] !== value) node.dataset[key] = value;
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node && node.textContent !== text) node.textContent = text;
}

installCreatorUnifiedRuntime();

export const CREATOR_UNIFIED_EXECUTION_POLICY = Object.freeze({
  productMode: 'unified',
  executorSelection: 'best_available',
  connectivityIsImplementationDetail: true,
  providerBrandHiddenFromPrimaryUI: true,
  fallbackBeforeRemoteDispatchWhenSupported: true,
  remoteFailureNeverFabricatesSuccess: true,
  remoteOnlyFailureScope: 'action-only',
});
