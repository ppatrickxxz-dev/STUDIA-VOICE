let installed = false;

function syncConnectivity() {
  const online = navigator.onLine !== false;
  const html = document.documentElement;
  html.dataset.pvStudioMode = 'unified';
  html.dataset.pvNetworkMode = online ? 'online' : 'offline';
  html.dataset.pvOfflineMode = online ? 'false' : 'true';
  html.dataset.pvAccessMode = 'transparent-device';

  document.querySelectorAll('[data-pv-network-state]').forEach((node) => {
    node.textContent = online ? 'Conectado' : 'Sem conexão';
    node.dataset.state = online ? 'online' : 'offline';
  });
}

export function installCreatorUnifiedRuntime() {
  if (installed) return () => {};
  installed = true;
  window.addEventListener('online', syncConnectivity);
  window.addEventListener('offline', syncConnectivity);
  syncConnectivity();
  return () => {
    window.removeEventListener('online', syncConnectivity);
    window.removeEventListener('offline', syncConnectivity);
    installed = false;
  };
}

installCreatorUnifiedRuntime();

export const CREATOR_UNIFIED_EXECUTION_POLICY = Object.freeze({
  productMode: 'one-product',
  creatorOwner: 'song-creation-studio',
  connectivityIsImplementationDetail: true,
  injectsAlternativeCreator: false,
  hidesProfessionalCreator: false,
  localToyFallback: false,
  pendingNetworkActionsArePreserved: true,
  userLoginRequired: false,
  passwordPrompt: false,
  transparentDeviceAccess: true,
});
