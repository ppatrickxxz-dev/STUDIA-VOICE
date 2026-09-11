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
    setDataset(html, 'pvNetworkMode', 'online');

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
    if (item.value === '60') item.textContent = '1:00 · curta';
    if (item.value === '120') item.textContent = '2:00 · média';
  }
}

function ensureUnifiedCreation(form) {
  const local = form.querySelector('[data-song-create-button]');
  const connected = form.querySelector('[data-song-create-hq]');
  if (!connected && !local) return;

  setDataset(form, 'pvNetworkPolicy', 'online_only');
  setDataset(form, 'pvExecutionPolicy', 'high_quality_only');

  const localCard = local?.closest('.pv-song-mode-card');
  const connectedCard = connected?.closest('.pv-song-mode-card');
  if (localCard && !localCard.hidden) localCard.hidden = true;
  if (connectedCard && !connectedCard.hidden) connectedCard.hidden = true;
  if (local && !local.hidden) local.hidden = true;
  if (connected && !connected.hidden) connected.hidden = true;
  form.querySelectorAll('[data-pv-local-draft]').forEach((node) => node.remove());

  let card = form.querySelector('[data-pv-unified-create-card]');
  if (!card) {
    card = document.createElement('section');
    card.className = 'pv-song-mode-card pv-unified-create-card';
    card.dataset.pvUnifiedCreateCard = 'true';
    card.innerHTML = '<div><strong>Produzir música</strong><span>Criação completa no motor musical de alta qualidade do PabloVoice.</span></div><div class="pv-actions"><button class="pv-btn primary" type="button" data-pv-unified-create>● Produzir em alta qualidade</button></div>';
    const anchor = localCard || connectedCard || form.firstElementChild;
    if (anchor) anchor.insertAdjacentElement('beforebegin', card);
    else form.appendChild(card);
  }

  const instrumental = Boolean(form.elements.instrumentalFirst?.checked);
  const button = card.querySelector('[data-pv-unified-create]');
  if (!button) return;
  const connectedAvailable = Boolean(connected && !connected.disabled);
  const busy = runtime.running;
  const buttonDisabled = busy || !connectedAvailable;
  if (button.disabled !== buttonDisabled) button.disabled = buttonDisabled;
  button.classList.toggle('busy', runtime.running);
  if (!runtime.running) setText(button, instrumental ? '● Produzir instrumental em alta qualidade' : '● Produzir em alta qualidade');
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
  const connected = form.querySelector('[data-song-create-hq]');
  const status = form.querySelector('#pv-song-create-status, [data-song-create-status]');

  runtime.running = true;
  if (!button.disabled) button.disabled = true;
  button.classList.add('busy');
  setText(button, '● Conectando ao motor musical…');

  try {
    if (navigator.onLine === false) {
      setText(status, 'A criação musical precisa de conexão com a internet. O PabloVoice não usa um modo offline alternativo.');
      status?.classList.add('error');
      return;
    }

    const session = await runtime.auth.ensureSession().catch(() => null);
    if (session?.accessToken && connected && !connected.disabled) {
      status?.classList.remove('error');
      connected.dataset.pvAuthBypass = '1';
      connected.click();
      return;
    }

    setText(status, 'Não consegui conectar ao motor musical agora. Tente novamente; não há login, senha ou modo alternativo para liberar recursos.');
    status?.classList.add('error');
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
  executorSelection: 'high_quality_online_only',
  connectivityIsImplementationDetail: true,
  providerBrandHiddenFromPrimaryUI: true,
  fallbackBeforeRemoteDispatchWhenSupported: false,
  localDraftRequiresExplicitUserChoice: false,
  localDraftAvailable: false,
  userLoginRequired: false,
  passwordPrompt: false,
  transparentDeviceAccess: true,
  offlineMode: false,
  remoteFailureNeverFabricatesSuccess: true,
  remoteOnlyFailureScope: 'action-only',
});