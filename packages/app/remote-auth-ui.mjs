import { RemoteAuthAdapter } from './remote-auth.mjs';

const auth = new RemoteAuthAdapter();
let observer;
let busy = false;

auth.consumeBootstrapFragment();

export function installRemoteAuthUI() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(() => injectPairing());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('submit', handleSubmit);
  injectPairing();
  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('submit', handleSubmit);
  };
}

async function injectPairing() {
  if (document.querySelector('#pv-remote-pairing')) return;
  const session = await auth.ensureSession().catch(() => null);
  if (session?.accessToken) return;
  const host = findHost();
  if (!host) return;
  const card = document.createElement('article');
  card.id = 'pv-remote-pairing';
  card.className = 'pv-card chrome';
  card.innerHTML = `<div class="pv-card-head"><div><h3>Conectar IA</h3><p>Pareie este aparelho uma vez para usar Composer, stems, Voice Lab e harmonias online.</p></div><span class="pv-tag">SEGURO</span></div>
    <form class="pv-compose-row" data-remote-pair-form>
      <input class="pv-field" name="code" inputmode="text" autocomplete="one-time-code" maxlength="64" placeholder="Código de conexão" aria-label="Código de conexão do PabloVoice">
      <button class="pv-btn primary" type="submit">Conectar</button>
    </form>
    <div class="pv-note" data-remote-pair-status>O código é de uso único. Depois, o aparelho usa um token rotativo e você não precisa repetir o pareamento.</div>`;
  host.insertAdjacentElement('beforebegin', card);
}

function findHost() {
  const capability = [...document.querySelectorAll('.pv-card')].find((card) => card.querySelector('h3')?.textContent?.trim() === 'Capacidades');
  if (capability) return capability;
  const composer = document.querySelector('#pv-ai-composer');
  if (composer) return composer;
  const voice = document.querySelector('#pv-ai-voice-harmony');
  if (voice) return voice;
  return null;
}

async function handleSubmit(event) {
  const form = event.target.closest('[data-remote-pair-form]');
  if (!form) return;
  event.preventDefault();
  if (busy) return;
  const code = String(form.elements.code?.value || '').trim();
  const status = form.parentElement?.querySelector('[data-remote-pair-status]');
  const button = form.querySelector('button[type="submit"]');
  if (!code) {
    setText(status, 'Digite o código de conexão.');
    return;
  }
  busy = true;
  if (button) { button.disabled = true; button.textContent = 'Conectando…'; }
  setText(status, 'Pareando este aparelho com sua conta…');
  try {
    await auth.loginWithBootstrapCode(code);
    setText(status, 'IA conectada neste aparelho. Composer, stems e Voice Lab já podem usar sua sessão.');
    form.remove();
    document.dispatchEvent(new CustomEvent('pablovoice:remote-authenticated'));
  } catch (error) {
    setText(status, humanError(error));
  } finally {
    busy = false;
    if (button?.isConnected) { button.disabled = false; button.textContent = 'Conectar'; }
  }
}

function humanError(error) {
  const text = String(error?.message || error || 'Falha ao conectar.');
  if (text.includes('bootstrap_invalid')) return 'Código inválido, expirado ou já usado.';
  if (text.includes('bootstrap_used')) return 'Esse código já foi usado. Gere um novo código.';
  return text;
}

function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

export const REMOTE_PAIRING_POLICY = Object.freeze({
  oneTimeBootstrapCode: true,
  rotatingDeviceToken: true,
  noProviderSecretInClient: true,
  noPasswordStoredInApp: true,
});
