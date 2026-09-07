const POCKET_MODES = Object.freeze([
  { id: 'vibe', label: 'Vibe', companion: 'Star Spark', copy: 'Começar pelo sentimento, clima e energia.' },
  { id: 'focus', label: 'Foco', companion: 'Wave Ribbon', copy: 'Trabalhar uma seção ou decisão sem mexer no resto.' },
  { id: 'inspiration', label: 'Inspiração', companion: 'Nota Drop', copy: 'Explorar letra, melodia, hook e alternativas.' },
  { id: 'moment', label: 'Momento', companion: 'Chime Lantern', copy: 'Registrar a ideia agora e lapidar depois.' },
]);

const ACTION_STATES = Object.freeze({
  listening: { label: 'OUVINDO', physical: 'listening', copy: 'Pablo está recebendo sua ideia.' },
  thinking: { label: 'PENSANDO', physical: 'thinking', copy: 'Cruzando intenção, projeto e decisões anteriores.' },
  creating: { label: 'CRIANDO', physical: 'happy', copy: 'Transformando a direção em música ou instrumental.' },
  analyzing: { label: 'ANALISANDO', physical: 'thinking', copy: 'Lendo letra, áudio, seção ou evidência musical.' },
  guiding: { label: 'GUIANDO', physical: 'listening', copy: 'Mostrando o próximo ajuste sem tomar a decisão por você.' },
  processing: { label: 'PROCESSANDO', physical: 'recording', copy: 'Executando uma operação real e preservando o original.' },
  approving: { label: 'APROVANDO', physical: 'happy', copy: 'A versão está pronta para sua comparação e escolha.' },
  celebrating: { label: 'COMEMORANDO', physical: 'dancing', copy: 'Take salvo. Nada foi sobrescrito sem sua escolha.' },
});

let mode = restoreMode();
let timer = 0;
let observer = null;
let queued = false;

export function installPabloLifeUI() {
  document.documentElement.dataset.pvPocketMode = mode;
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(queueRender);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('input', onInput, true);
  document.addEventListener('pablovoice:musical-plan-applied', () => setActionState('celebrating', 2300));
  document.addEventListener('pablovoice:remote-authenticated', () => setActionState('approving', 1800));
  window.addEventListener('offline', () => setActionState('guiding', 1800));
  window.addEventListener('online', () => setActionState('approving', 1800));
  queueRender();
  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('input', onInput, true);
    clearTimeout(timer);
  };
}

function queueRender() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    renderModeControls();
    syncReadouts();
  });
}

function renderModeControls() {
  const hosts = [document.querySelector('#pv-intimate-home .pv-recorder-head'), document.querySelector('[data-pv-pablo-intimacy]')].filter(Boolean);
  for (const host of hosts) {
    if (host.querySelector('[data-pv-pocket-modes]')) continue;
    const strip = document.createElement('div');
    strip.className = 'pv-pocket-mode-strip';
    strip.dataset.pvPocketModes = 'true';
    strip.setAttribute('aria-label', 'Modo criativo do Pocket');
    strip.innerHTML = POCKET_MODES.map((item) => `<button type="button" data-pv-pocket-mode-button="${item.id}" title="${item.companion} · ${item.copy}">${item.label}</button>`).join('');
    host.appendChild(strip);
  }
  document.querySelectorAll('[data-pv-pocket-mode-button]').forEach((button) => button.classList.toggle('active', button.dataset.pvPocketModeButton === mode));
}

function onClick(event) {
  const target = event.target.closest('button, [data-action], [data-route]');
  if (!target) return;
  if (target.matches('[data-pv-pocket-mode-button]')) {
    event.preventDefault();
    setMode(target.dataset.pvPocketModeButton);
    return;
  }
  if (target.matches('[data-pv-create], [data-song-create-hq], [data-song-create-button]')) return setActionState('creating');
  if (target.matches('[data-musical-plan-preview]')) return setActionState('analyzing', 1900);
  if (target.matches('[data-musical-plan-apply]')) return setActionState('processing');
  if (target.matches('[data-section-map-open], [data-beat-lab-open]')) return setActionState('guiding', 1700);
  if (target.matches('[data-action="record"], [data-pv-record]')) return setActionState('listening');
  if (target.matches('[data-action="stop-record"]')) return setActionState('approving', 1700);
  if (target.matches('[data-action="export"]')) return setActionState('processing', 1800);
  if (target.matches('[data-action="play"]')) return setActionState('analyzing', 1500);
}

function onSubmit(event) {
  if (event.target.matches('[data-ai-compose-form]')) setActionState('thinking');
  if (event.target.matches('[data-song-create-form]')) setActionState('creating');
  if (event.target.matches('[data-remote-pair-form]')) setActionState('processing');
}

function onInput(event) {
  if (event.target.matches('#lyrics, [data-song-create-form] input[name="brief"], [data-pablo-input]')) setActionState('listening', 950);
}

function setMode(next) {
  if (!POCKET_MODES.some((item) => item.id === next)) return;
  mode = next;
  try { localStorage.setItem('pablovoice.pocketMode', mode); } catch {}
  document.documentElement.dataset.pvPocketMode = mode;
  const selected = POCKET_MODES.find((item) => item.id === mode);
  document.querySelectorAll('[data-pv-pocket-mode-button]').forEach((button) => button.classList.toggle('active', button.dataset.pvPocketModeButton === mode));
  setActionState('guiding', 1700, `${selected.label}: ${selected.copy}`);
}

function setActionState(state, duration = 0, overrideCopy = '') {
  const spec = ACTION_STATES[state];
  if (!spec) return;
  document.documentElement.dataset.pvActionState = state;
  document.documentElement.dataset.pvPabloState = spec.physical;
  document.querySelectorAll('[data-pv-action-label]').forEach((node) => setText(node, spec.label));
  document.querySelectorAll('[data-pv-action-copy]').forEach((node) => setText(node, overrideCopy || spec.copy));
  document.querySelectorAll('[data-pv-state-label]').forEach((node) => setText(node, spec.label));
  if (overrideCopy) document.querySelectorAll('[data-pv-pablo-line]').forEach((node) => setText(node, overrideCopy));
  clearTimeout(timer);
  if (duration > 0) timer = setTimeout(() => {
    delete document.documentElement.dataset.pvActionState;
    queueRender();
  }, duration);
  queueRender();
}

function syncReadouts() {
  const current = document.documentElement.dataset.pvActionState;
  const spec = ACTION_STATES[current];
  if (!spec) return;
  document.querySelectorAll('[data-pv-action-label]').forEach((node) => setText(node, spec.label));
  document.querySelectorAll('[data-pv-action-copy]').forEach((node) => setText(node, spec.copy));
}

function restoreMode() {
  try {
    const stored = localStorage.getItem('pablovoice.pocketMode');
    if (POCKET_MODES.some((item) => item.id === stored)) return stored;
  } catch {}
  return 'vibe';
}

function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

export const PABLOVOICE_POCKET_MODES = POCKET_MODES;
export const PABLOVOICE_ACTION_STATES = ACTION_STATES;
