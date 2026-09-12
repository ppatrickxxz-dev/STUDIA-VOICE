import { RemoteAuthAdapter } from './remote-auth.mjs';

const auth = new RemoteAuthAdapter();
const LOCAL_TEST = /^https?:\/\/(?:127\.0\.0\.1|localhost):4173$/i.test(String(globalThis.location?.origin || ''));
let installed = false;
let connecting = null;

auth.consumeBootstrapFragment();

async function connectSilently() {
  if (LOCAL_TEST) return null;
  if (connecting) return connecting;
  connecting = auth.ensureSession()
    .then((session) => {
      document.documentElement.dataset.pvConnected = session?.accessToken ? 'true' : 'false';
      if (session?.accessToken) document.dispatchEvent(new CustomEvent('pablovoice:online-ready'));
      return session;
    })
    .catch(() => {
      document.documentElement.dataset.pvConnected = 'false';
      return null;
    })
    .finally(() => { connecting = null; });
  return connecting;
}

export function installRemoteAuthUI() {
  if (installed) return () => {};
  installed = true;
  document.querySelectorAll('#pv-remote-pairing,[data-remote-pair-form]').forEach((node) => node.remove());
  const handleRequest = () => { connectSilently(); };
  const handleOnline = () => { connectSilently(); };
  document.addEventListener('pablovoice:request-online-auth', handleRequest);
  window.addEventListener('online', handleOnline);
  connectSilently();
  return () => {
    installed = false;
    document.removeEventListener('pablovoice:request-online-auth', handleRequest);
    window.removeEventListener('online', handleOnline);
  };
}

export const REMOTE_PAIRING_POLICY = Object.freeze({
  passwordlessOwnerEmail: false,
  activationCodeRequired: false,
  rotatingDeviceToken: true,
  noProviderSecretInClient: true,
  noPasswordStoredInApp: true,
  demandDrivenUI: false,
  creatorSurfaceVisible: false,
  blocksCreativeInterface: false,
  noSilentOfflineFallback: true,
  transparentDeviceAccess: true,
  userLoginUI: false,
  offlineMode: false,
});
