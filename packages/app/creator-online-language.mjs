import { RemoteAuthAdapter } from './remote-auth.mjs';

const runtime = {
  observer: null,
  queued: false,
  applying: false,
  running: false,
  auth: new RemoteAuthAdapter(),
};

export function installCreatorOnlineLanguage() {
  if (runtime.observer) return () => disconnect();
  runtime.observer = new MutationObserver(queueSync);
  runtime.observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['hidden', 'disabled', 'data-pv-network-mode', 'data-pv-network-policy'],
  });
  document.addEventListener('click', onUnifiedCreate, true);
  window.addEventListener('online', queueSync);
  window.addEventListener('offline', queueSync);
  queueSync();
  return disconnect;
}

function disconnect() {
  runtime.observer?.disconnect();
  runtime.observer = null;
  document.removeEventListener('click', onUnifiedCreate, true);
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
    setDataset(html, 'pvNetworkMode', 'adaptive');

    const health = document.querySelector('.pv-health');
    if (health) setHtml(health, '<span></span>STUDIO · PRONTO');

    document.querySelectorAll('[data-pv-network-copy]').forEach((node) => {
      setText(node, 'motor adaptativo · mesmo projeto');
    });

    const homeLead = document.querySelector('.pv-intimate-home-hero .pv-lead');
    if (homeLead) {
      setText(homeLead, 'Sua ideia ganha som. O PabloVoice escolhe o melhor motor disponível sem mudar seu fluxo, projeto ou ferramentas.');
    }

    const form = document.querySelector('[data-song-create-form]');
    if (form) {
      ensureCompleteDuration(form);
      ensureUnifiedCreation(form);
      normalizeCreationStatus(form);
      normalizeCreationResult(form);
    }
  } finally {
    runtime.applying = false;
  }
}

function ensureCompleteDuration(form) {
  const duration = form.elements.duration;
  if (!(duration instanceof HTMLSelectElement) || duration.querySelector('option[value="200"]')) return;
  const option = document.createElement('option');
  option.value = '200';
  option.textContent = '3:20 · completa';
  duration.appendChild(option);
  for (const item of duration.options) {
    if (item.value === '60' && /rascunho/i.test(item.textContent)) item.textContent = '1:00 · curta';
    if (item.value === '120' && /demo/i.test(item.textContent)) item.textContent = '2:00 · média';
  }
}

function ensureUnifiedCreation(form) {
  const local = form.querySelector('[data-song-create-button]');
  const connected = form.querySelector('[data-song-create-hq]');
  if (!local && !connected) return;

  setDataset(form, 'pvNetworkPolicy', 'adaptive_unified');
  setDataset(form, 'pvExecutionPolicy', 'best_available');

  const localCard = local?.closest('.pv-song-mode-card');
  const connectedCard = connected?.closest('.pv-song-mode-card');
  if (localCard && !localCard.hidden) localCard.hidden = true;
  if (connectedCard && !connectedCard.hidden) connectedCard.hidden = true;

  let card = form.querySelector('[data-pv-unified-create-card]');
  if (!card) {
    card = document.createElement('section');
    card.className = 'pv-song-mode-card pv-unified-create-card';
    card.dataset.pvUnifiedCreateCard = 'true';
    card.innerHTML = '<div><strong>Produzir no PabloVoice</strong><span>Um único fluxo. O Studio escolhe automaticamente o melhor executor disponível e mantém o mesmo projeto editável.</span></div><button class="pv-btn primary" type="button" data-pv-unified-create>● Produzir música</button>';
    (localCard || connectedCard || form.firstElementChild)?.insertAdjacentElement('beforebegin', card);
    if (!card.isConnected) form.appendChild(card);
  }

  const instrumental = Boolean(form.elements.instrumentalFirst?.checked);
  const button = card.querySelector('[data-pv-unified-create]');
  if (button) {
    const busy = Boolean(local?.disabled || connected?.disabled || runtime.running);
    if (button.disabled !== busy) button.disabled = busy;
    button.classList.toggle('busy', busy);
    if (!busy) setText(button, instrumental ? '● Produzir instrumental' : '● Produzir música');
  }
}

async function onUnifiedCreate(event) {
  const button = event.target.closest('[data-pv-unified-create]');
  if (!button) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (runtime.running) return;

  const form = button.closest('[data-song-create-form]');
  if (!form) return;
  const local = form.querySelector('[data-song-create-button]');
  const connected = form.querySelector('[data-song-create-hq]');

  runtime.running = true;
  button.disabled = true;
  button.classList.add('busy');
  setText(button, '● Preparando produção…');
  setStatus(form, 'Escolhendo o melhor executor disponível para esta criação…');

  try {
    let session = null;
    if (navigator.onLine !== false && connected && !connected.disabled) {
      session = await runtime.auth.ensureSession().catch(() => null);
    }

    if (session?.accessToken && connected && !connected.disabled) {
      connected.dataset.pvAuthBypass = '1';
      connected.click();
      return;
    }

    if (local && !local.disabled) {
      // The intimate layer historically redirected local submit to the connected
      // button while online. Hiding the internal connected executor for this
      // synchronous dispatch keeps fallback selection inside this unified router.
      if (connected && !connected.hidden) connected.hidden = true;
      local.click();
      return;
    }

    setStatus(form, 'Nenhum executor está pronto para esta ação agora. O projeto continua aberto e editável.', 'error');
  } finally {
    runtime.running = false;
    queueSync();
  }
}

function normalizeCreationStatus(form) {
  const status = form.querySelector('#pv-song-create-status, [data-song-create-status]');
  if (!status) return;
  let text = String(status.textContent || '');
  const replacements = [
    [/produção completa conectada/gi, 'produção do PabloVoice'],
    [/produção conectada/gi, 'produção do PabloVoice'],
    [/cria(?:ção|r) offline/gi, 'criação no PabloVoice'],
    [/sem rede[^.]*\.?/gi, 'O Studio continua disponível.'],
    [/conecte sua sessão[^.]*\.?/gi, 'O Studio pode usar outro executor disponível.'],
    [/reconheça este aparelho[^.]*\.?/gi, 'O Studio pode usar outro executor disponível.'],
  ];
  for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
  setText(status, text);
}

function normalizeCreationResult(form) {
  const result = form.closest('#pv-song-creator')?.querySelector('#pv-song-create-result .pv-song-result');
  if (!result) return;
  const badge = result.querySelector('.pv-card-head .pv-tag');
  if (badge && /HQ|CONECTADO|ONLINE|OFFLINE|LOCAL/i.test(badge.textContent || '')) setText(badge, 'SALVO · EDITÁVEL');

  result.querySelectorAll('.pv-song-audios label').forEach((card) => {
    const strong = card.querySelector('strong');
    const note = card.querySelector('small');
    if (strong) {
      const label = String(strong.textContent || '')
        .replace(/Demo IA HQ · base/gi, 'Base produzida')
        .replace(/Demo IA HQ/gi, 'Versão produzida')
        .replace(/Base conectada/gi, 'Base produzida')
        .replace(/Versão conectada/gi, 'Versão produzida');
      setText(strong, label);
    }
    if (note) {
      const copy = String(note.textContent || '')
        .replace(/produção conectada/gi, 'produção do PabloVoice')
        .replace(/geração HQ/gi, 'produção')
        .replace(/mix de referência de alta qualidade/gi, 'mix de referência');
      setText(note, copy);
    }
  });
}

function setStatus(form, message, kind = '') {
  const status = form.querySelector('#pv-song-create-status, [data-song-create-status]');
  if (!status) return;
  setText(status, message);
  status.classList.toggle('error', kind === 'error');
}

function setDataset(node, key, value) {
  if (node?.dataset?.[key] !== value) node.dataset[key] = value;
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node && node.textContent !== text) node.textContent = text;
}

function setHtml(node, value) {
  if (node && node.innerHTML !== value) node.innerHTML = value;
}

installCreatorOnlineLanguage();

export const CREATOR_UNIFIED_EXECUTION_POLICY = Object.freeze({
  productMode: 'unified',
  executorSelection: 'best_available',
  connectivityIsImplementationDetail: true,
  providerBrandHiddenFromPrimaryUI: true,
  fallbackBeforeRemoteDispatchWhenSupported: true,
  remoteFailureNeverFabricatesSuccess: true,
  remoteOnlyFailureScope: 'action-only',
});
