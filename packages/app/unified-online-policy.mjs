const POLICY = Object.freeze({
  productMode: 'unified',
  creationMode: 'professional_remote_with_offline_queue',
  userLoginRequired: false,
  passwordPrompt: false,
  localProjectAvailableOffline: true,
  localToyFallback: false,
  pendingNetworkActionsArePreserved: true,
});

let observer = null;
let queued = false;

function setDataset(node, key, value) {
  if (node?.dataset?.[key] !== value) node.dataset[key] = value;
}

function syncConnectivity() {
  const online = navigator.onLine !== false;
  const html = document.documentElement;
  setDataset(html, 'pvStudioMode', 'unified');
  setDataset(html, 'pvNetworkMode', online ? 'online' : 'offline');
  setDataset(html, 'pvAccessMode', 'transparent-device');
  setDataset(html, 'pvOfflineMode', online ? 'false' : 'true');

  // Access stays transparent. Legacy pairing/login surfaces must never block the owner.
  document.querySelectorAll('#pv-remote-pairing,[data-remote-pair-form]').forEach((node) => node.remove());

  // The current professional Creator owns these controls. Do not hide or replace it.
  const form = document.querySelector('[data-song-create-form]');
  if (form) {
    setDataset(form, 'pvNetworkPolicy', 'offline_queue');
    setDataset(form, 'pvExecutionPolicy', 'professional_only');
    setDataset(form, 'pvConnectivity', online ? 'online' : 'offline');
  }
}

function queueApply() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    syncConnectivity();
  });
}

export function installUnifiedOnlinePolicy() {
  if (observer) return () => observer?.disconnect();
  syncConnectivity();
  observer = new MutationObserver(queueApply);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
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
