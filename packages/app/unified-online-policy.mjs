const POLICY = Object.freeze({
  productMode: 'unified',
  creationMode: 'online_high_quality_only',
  userLoginRequired: false,
  passwordPrompt: false,
  offlineMode: false,
  localDraftAvailable: false,
});

let observer = null;
let queued = false;

function setText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

function setDataset(node, key, value) {
  if (node?.dataset?.[key] !== value) node.dataset[key] = value;
}

function hide(node) {
  if (node && !node.hidden) node.hidden = true;
}

function applyPolicy() {
  const html = document.documentElement;
  setDataset(html, 'pvStudioMode', 'unified');
  setDataset(html, 'pvNetworkMode', 'online');
  setDataset(html, 'pvAccessMode', 'transparent-device');
  setDataset(html, 'pvOfflineMode', 'false');

  document.querySelectorAll('#pv-remote-pairing,[data-remote-pair-form],[data-pv-local-draft]').forEach((node) => node.remove());
  document.querySelectorAll('[data-song-create-button]').forEach((button) => {
    hide(button);
    hide(button.closest('.pv-song-mode-card'));
  });

  const form = document.querySelector('[data-song-create-form]');
  if (form) {
    setDataset(form, 'pvNetworkPolicy', 'online_only');
    setDataset(form, 'pvExecutionPolicy', 'high_quality_only');
  }

  const health = document.querySelector('.pv-health');
  if (health) {
    health.classList.toggle('connected', navigator.onLine !== false);
    setText(health, navigator.onLine === false ? '● CONEXÃO NECESSÁRIA' : '● STUDIO CONECTADO');
  }

  document.querySelectorAll('[data-pv-network-copy]').forEach((node) => {
    setText(node, navigator.onLine === false ? 'conecte-se para criar' : 'produção em alta qualidade conectada');
  });

  const lead = document.querySelector('.pv-intimate-home-hero .pv-lead');
  if (lead) setText(lead, 'Sua ideia ganha som em um único Studio conectado, sem login, senha ou modo offline separado.');
}

function queueApply() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    applyPolicy();
  });
}

export function installUnifiedOnlinePolicy() {
  if (observer) return () => observer?.disconnect();
  observer = new MutationObserver(queueApply);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'data-pv-network-mode', 'data-pv-network-policy', 'data-pv-execution-policy'] });
  window.addEventListener('online', queueApply);
  window.addEventListener('offline', queueApply);
  queueApply();
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('online', queueApply);
    window.removeEventListener('offline', queueApply);
  };
}

installUnifiedOnlinePolicy();
export const UNIFIED_ONLINE_POLICY = POLICY;
