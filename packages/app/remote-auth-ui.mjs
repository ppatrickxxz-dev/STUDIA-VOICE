import { RemoteAuthAdapter } from './remote-auth.mjs';

const auth = new RemoteAuthAdapter();
let observer;
let busy = false;
let requestedReason = null;

auth.consumeBootstrapFragment();

export function installRemoteAuthUI() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(() => injectPairing());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('submit', handleSubmit);
  document.addEventListener('pablovoice:request-online-auth', handleRequest);
  injectPairing();
  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('submit', handleSubmit);
    document.removeEventListener('pablovoice:request-online-auth', handleRequest);
  };
}

async function injectPairing() {
  const before = document.querySelector('#pv-remote-pairing');
  const session = await auth.ensureSession().catch(() => null);
  if (session?.accessToken) {
    document.querySelectorAll('#pv-remote-pairing').forEach((node) => node.remove());
    return null;
  }

  // The observer can fire again while ensureSession is pending. Re-check after the
  // async boundary so two activation cards can never be inserted.
  const existing = before?.isConnected ? before : document.querySelector('#pv-remote-pairing');
  if (existing) {
    syncCard(existing);
    return existing;
  }
  const host = findHost();
  if (!host) return null;
  const card = document.createElement('article');
  card.id = 'pv-remote-pairing';
  card.className = 'pv-card chrome pv-online-activation';
  card.hidden = true;
  card.innerHTML = `<div class="pv-card-head"><div><h3>Reconhecer este aparelho</h3><p>Os recursos conectados ficam ativos no fluxo normal. Faça este vínculo uma vez.</p></div><span class="pv-tag">1 VEZ</span></div>
    <form class="pv-compose-row" data-remote-pair-form>
      <input class="pv-field" name="code" inputmode="text" autocomplete="one-time-code" maxlength="64" placeholder="Código de ativação" aria-label="Código de ativação do PabloVoice">
      <button class="pv-btn primary" type="submit">Conectar</button>
    </form>
    <div class="pv-note" data-remote-pair-status>Este passo só aparece quando uma função online precisa reconhecer o aparelho.</div>`;
  host.insertAdjacentElement('beforebegin', card);
  syncCard(card);
  return card;
}

function findHost() {
  const creator = document.querySelector('#pv-song-creator');
  if (creator) return creator.querySelector('#pv-song-create-result') || creator;
  const composer = document.querySelector('#pv-ai-composer');
  if (composer) return composer;
  const voice = document.querySelector('#pv-ai-voice-harmony');
  if (voice) return voice;
  const capability = [...document.querySelectorAll('.pv-card')].find((card) => card.querySelector('h3')?.textContent?.trim() === 'Capacidades');
  return capability || null;
}

async function handleRequest(event) {
  requestedReason = String(event.detail?.reason || 'Este recurso').slice(0, 120);
  const card = await injectPairing();
  if (!card) return;
  card.hidden = false;
  card.dataset.pvUserVisible = 'true';
  syncCard(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => card.querySelector('input[name="code"]')?.focus(), 180);
}

function syncCard(card) {
  if (!card) return;
  const status = card.querySelector('[data-remote-pair-status]');
  if (requestedReason && card.dataset.pvUserVisible === 'true') {
    setText(status, `${requestedReason} usa a produção conectada. Cole seu código uma vez; depois este aparelho fica reconhecido.`);
  }
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
  if (button) { button.disabled = true; button.textContent = 'Conectando…'; }
  setText(status, 'Reconhecendo este aparelho…');
  try {
    await auth.loginWithBootstrapCode(code);
    setText(status, 'Pronto. O PabloVoice conectado está ativo neste aparelho.');
    form.remove();
    requestedReason = null;
    document.dispatchEvent(new CustomEvent('pablovoice:remote-authenticated'));
    setTimeout(() => card?.remove(), 700);
  } catch (error) {
    setText(status, humanError(error));
  } finally {
    busy = false;
    if (button?.isConnected) { button.disabled = false; button.textContent = 'Conectar'; }
  }
}

function humanError(error) {
  const text = String(error?.message || error || 'Não consegui conectar agora.');
  if (text.includes('bootstrap_invalid')) return 'Esse código venceu ou não é mais válido. Peça um novo código.';
  if (text.includes('bootstrap_used')) return 'Esse código já foi usado. Peça um novo código.';
  if (text.includes('fetch')) return 'A rede existe, mas o serviço não respondeu. O PabloVoice não troca silenciosamente para local: tente novamente.';
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
  demandDrivenUI: true,
  noSilentOfflineFallback: true,
});
