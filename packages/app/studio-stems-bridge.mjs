let observer = null;
let queued = false;

export function installStudioStemsBridge() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(queueSync);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  window.addEventListener('online', queueSync);
  window.addEventListener('offline', queueSync);
  document.addEventListener('pablovoice:stems-imported', onImported);
  queueSync();
  return () => {
    observer?.disconnect();
    observer = null;
    window.removeEventListener('online', queueSync);
    window.removeEventListener('offline', queueSync);
    document.removeEventListener('pablovoice:stems-imported', onImported);
  };
}

function queueSync() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    sync();
  });
}

function sync() {
  const rail = document.querySelector('[data-pv-studio-rail] .pv-studio-life-steps');
  if (!rail) return;
  let button = rail.querySelector('[data-pv-studio-stems]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.pvStudioStems = 'true';
    button.addEventListener('click', triggerStems);
    const master = rail.querySelector('[data-pv-studio-step="export"]');
    if (master) master.insertAdjacentElement('beforebegin', button);
    else rail.appendChild(button);
  }
  const offline = navigator.onLine === false;
  const source = document.querySelector('#pv-stems-canary-run');
  const disabled = offline || Boolean(source?.disabled);
  const label = offline ? 'STEMS · OFF' : source?.disabled ? 'STEMS…' : 'STEMS';
  const title = offline
    ? 'A separação de stems precisa de conexão.'
    : 'Separar a faixa ativa em Vocal + Instrumental e importar os resultados no projeto.';
  if (button.disabled !== disabled) button.disabled = disabled;
  if (button.textContent !== label) button.textContent = label;
  if (button.title !== title) button.title = title;
}

function triggerStems(event) {
  event.preventDefault();
  if (navigator.onLine === false) return;
  const button = document.querySelector('#pv-stems-canary-run');
  if (button && !button.disabled) {
    document.documentElement.dataset.pvActionState = 'processing';
    document.documentElement.dataset.pvPabloState = 'recording';
    document.querySelectorAll('[data-pv-state-label]').forEach((node) => {
      if (node.textContent !== 'PROCESSANDO') node.textContent = 'PROCESSANDO';
    });
    button.click();
    document.querySelector('#pv-stems-canary')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function onImported() {
  document.documentElement.dataset.pvActionState = 'approving';
  document.documentElement.dataset.pvPabloState = 'happy';
  document.querySelectorAll('[data-pv-state-label]').forEach((node) => {
    if (node.textContent !== 'APROVANDO') node.textContent = 'APROVANDO';
  });
  const line = 'Separei Vocal + Instrumental e trouxe os dois de volta. Compara com o mix original antes de escolher.';
  document.querySelectorAll('[data-pv-pablo-line]').forEach((node) => {
    if (node.textContent !== line) node.textContent = line;
  });
  setTimeout(() => {
    delete document.documentElement.dataset.pvActionState;
  }, 2400);
  queueSync();
}

installStudioStemsBridge();

export const STUDIO_STEMS_BRIDGE_POLICY = Object.freeze({
  sameProjectImport: true,
  requiresNetwork: true,
  noAcousticPassClaim: true,
  compareBeforePromotion: true,
});
