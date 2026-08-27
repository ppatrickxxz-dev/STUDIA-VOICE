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
  const existing = document.querySelector('#pv-remote-pairing');
  const session = await auth.ensureSession().catch(() => null);
  if (session?.accessToken) {
    existing?.remove();
    return;
  }
  if (existing) return;
  const host = findHost();
  if (!host) return;
  const card = document.createElement('article');
  card.id = 'pv-remote-pairing';
  card.className = 'pv-card chrome';
  card.innerHTML = `<div class="pv-card-head"><div><h3>Ativar recursos online</h3><p>Ative uma vez para usar criação com Pablo, separação de voz e instrumental, Voice Lab e harmonias.</p></div><span class="pv-tag">1 VEZ</span></div>
    <form class="pv-compose-row" data-remote-pair-form>
      <input class="pv-field" name="code" inputmode="text" autocomplete="one-time-code" maxlength="64" placeholder="Código de ativação" aria-label="Código de ativação do PabloVoice">
      <button class="pv-btn primary" type="submit">Ativar</button>
    </form>
    <div class="pv-note" data-remote-pair-status>Depois de ativar, este aparelho fica reconhecido automaticamente.</div>`;
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
  const card = form.closest('#pv-remote-pairing');
  const status = card?.querySelector('[data-remote-pair-status]');
  const button = form.querySelector('button[type="submit"]');
  if (!code) {
    setText(status, 'Cole o código de ativação.');
    return;
  }
  busy = true;
  if (button) { button.disabled = true; button.textContent = 'Ativando…'; }
  setText(status, 'Ativando os recursos online deste aparelho…');
  try {
    await auth.loginWithBootstrapCode(code);
    setText(status, 'Pronto. Recursos online ativados neste aparelho.');
    form.remove();
    document.dispatchEvent(new CustomEvent('pablovoice:remote-authenticated'));
    setTimeout(() => card?.remove(), 900);
  } catch (error) {
    setText(status, humanError(error));
  } finally {
    busy = false;
    if (button?.isConnected) { button.disabled = false; button.textContent = 'Ativar'; }
  }
}

function humanError(error) {
  const text = String(error?.message || error || 'Não consegui ativar agora.');
  if (text.includes('bootstrap_invalid')) return 'Esse código venceu ou não é mais válido. Peça um novo código.';
  if (text.includes('bootstrap_used')) return 'Esse código já foi usado. Peça um novo código.';
  if (text.includes('fetch')) return 'Não consegui falar com o serviço online. Tente novamente em instantes.';
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
