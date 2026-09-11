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
  applyPolicy();
  observer = new MutationObserver(queueApply);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-pv-network-policy'],
  });
  window.addEventListener('online', queueApply);
  window.addEventListener('offline', queueApply);
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('online', queueApply);
    window.removeEventListener('offline', queueApply);
  };
}

installUnifiedOnlinePolicy();
export const UNIFIED_ONLINE_POLICY = POLICY;
