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
  card.hidden = false;
  card.dataset.pvUserVisible = 'true';
  card.innerHTML = `<div class="pv-card-head"><div><h3>Acesso do proprietário</h3><p>Entre uma vez neste aparelho para liberar Composer, geração musical de alta qualidade, voz, harmonias e processamento conectado.</p></div></div>
    <form class="pv-compose-row" data-remote-pair-form>
      <input class="pv-field" name="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="Seu e-mail" aria-label="E-mail do proprietário do PabloVoice">
      <button class="pv-btn primary" type="submit">Liberar meu estúdio</button>
    </form>
    <div class="pv-note" data-remote-pair-status>Sem código de ativação. Você recebe um link seguro por e-mail e este aparelho permanece conectado.</div>`;
  host.insertAdjacentElement('beforebegin', card);
  syncCard(card);
  return card;
}

function findHost() {
  // Owner access is a product-level prerequisite for the connected creator. It must
  // be reachable where the user actually creates, not only inside the capability modal.
  return document.querySelector('#pv-ai-composer')
    || document.querySelector('#pv-song-creator')
    || document.querySelector('[data-song-create-form]')?.closest('article')
    || document.querySelector('.pv-modal.wide .pv-cap-table');
}

async function handleRequest(event) {
  requestedReason = String(event.detail?.reason || 'Este recurso').slice(0, 120);
  const status = document.querySelector('#pv-song-create-status');
  setText(status, `${requestedReason} usa a produção conectada. Libere seu estúdio com o e-mail do proprietário.`);
  const card = await injectPairing();
  card?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  card?.querySelector('input[name="email"]')?.focus?.({ preventScroll: true });
}

function syncCard(card) {
  if (!card) return;
  const status = card.querySelector('[data-remote-pair-status]');
  if (requestedReason && card.dataset.pvUserVisible === 'true') {
    setText(status, `${requestedReason} usa a produção conectada. Entre com seu e-mail para liberar todos os recursos.`);
  }
}

async function handleSubmit(event) {
  const form = event.target.closest('[data-remote-pair-form]');
  if (!form) return;
  event.preventDefault();
  if (busy) return;
  const email = String(form.elements.email?.value || '').trim();
  const card = form.closest('#pv-remote-pairing');
  const status = card?.querySelector('[data-remote-pair-status]');
  const button = form.querySelector('button[type="submit"]');
  if (!email) {
    setText(status, 'Digite seu e-mail.');
    return;
  }
  busy = true;
  if (button) { button.disabled = true; button.textContent = 'Enviando…'; }
  setText(status, 'Preparando seu acesso seguro…');
  try {
    await auth.loginWithEmail(email);
    setText(status, 'Link enviado. Abra o e-mail neste aparelho para entrar e liberar o estúdio conectado.');
    form.hidden = true;
  } catch (error) {
    setText(status, humanError(error));
  } finally {
    busy = false;
    if (button?.isConnected) { button.disabled = false; button.textContent = 'Liberar meu estúdio'; }
  }
}

function humanError(error) {
  const text = String(error?.message || error || 'Não consegui conectar agora.');
  if (text.includes('bootstrap_invalid')) return 'Esse link venceu ou não é mais válido. Solicite um novo.';
  if (text.includes('bootstrap_used')) return 'Esse link já foi usado. Solicite um novo.';
  if (text.includes('fetch')) return 'A rede existe, mas o serviço não respondeu. Tente novamente.';
  return text;
}

function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

export const REMOTE_PAIRING_POLICY = Object.freeze({
  passwordlessOwnerEmail: true,
  activationCodeRequired: false,
  rotatingDeviceToken: true,
  noProviderSecretInClient: true,
  noPasswordStoredInApp: true,
  demandDrivenUI: false,
  creatorSurfaceVisible: true,
  blocksCreativeInterface: false,
  noSilentOfflineFallback: true,
});
