const PRODUCT_UI_VERSION = 'pablovoice_product_ui_v30';
const PROMPT_KEY = 'pablovoice.product.createPrompt';
const KIND_KEY = 'pablovoice.product.createKind';
const STUDIO_CUT = 'song_completion_v1';

const runtime = { observer: null, scheduled: false, frame: 0 };

export function installPabloVoiceProductUI() {
  if (runtime.observer) return disconnect;
  document.documentElement.dataset.pvProductUi = PRODUCT_UI_VERSION;
  runtime.observer = new MutationObserver(queueSync);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('click', onClick, true);
  window.addEventListener('hashchange', queueSync);
  window.addEventListener('online', queueSync);
  window.addEventListener('offline', queueSync);
  document.addEventListener('pablovoice:vnext-surface-ready', queueSync);
  document.addEventListener('pablovoice:project-updated', queueSync);
  queueSync();
  return disconnect;
}

function disconnect() {
  runtime.observer?.disconnect();
  runtime.observer = null;
  if (runtime.frame) cancelAnimationFrame(runtime.frame);
  runtime.frame = 0;
  runtime.scheduled = false;
  window.removeEventListener('click', onClick, true);
  window.removeEventListener('hashchange', queueSync);
  window.removeEventListener('online', queueSync);
  window.removeEventListener('offline', queueSync);
  document.removeEventListener('pablovoice:vnext-surface-ready', queueSync);
  document.removeEventListener('pablovoice:project-updated', queueSync);
}

function queueSync() {
  if (runtime.scheduled) return;
  runtime.scheduled = true;
  const run = () => {
    runtime.scheduled = false;
    runtime.frame = 0;
    syncProductUI();
  };
  if (typeof requestAnimationFrame === 'function') runtime.frame = requestAnimationFrame(run);
  else setTimeout(run, 0);
}

function syncProductUI() {
  decorateNavigation();
  const route = activeRoute();
  document.documentElement.dataset.pvProductRoute = route;
  if (route === 'home') decorateHome();
  if (route === 'compose') decorateCreate();
  if (route === 'studio') decorateStudio();
}

function activeRoute() {
  return document.querySelector('.pv-nav [data-route].active')?.dataset.route ||
    (document.querySelector('#lyrics') ? 'compose' : document.querySelector('.pv-transport-card') ? 'studio' : 'home');
}

function decorateNavigation() {
  const nav = document.querySelector('.pv-nav');
  if (!nav) return;
  nav.dataset.pvProductNav = 'true';
}

function decorateHome() {
  const main = document.querySelector('main');
  const hero = main?.querySelector('.pv-hero');
  if (!main || !hero) return;
  document.documentElement.dataset.pvProductHome = 'true';
  hero.dataset.pvProductHero = 'true';

  let surface = main.querySelector('#pv-product-home');
  if (!surface) {
    surface = document.createElement('section');
    surface.id = 'pv-product-home';
    surface.className = 'pv-product-home pv-product-home-song-first';
    surface.innerHTML = homeMarkup();
    hero.insertAdjacentElement('afterend', surface);
  }
  syncHomeState(surface);
}

function homeMarkup() {
  return `<div class="pv-product-create-card pv-product-create-card-v30">
    <div class="pv-product-create-head">
      <div>
        <span class="pv-product-eyebrow">PABLOVOICE</span>
        <h2 class="pv-product-context-heading">Criação musical.</h2>
        <h1 class="pv-product-title">Crie a música primeiro.</h1>
        <h2>Como ela deve soar?</h2>
        <p>Escreva como falaria com um produtor. A letra, a direção, as versões e a produção continuam no mesmo projeto.</p>
      </div>
      <div class="pv-product-head-actions">
        <span class="pv-product-ai-state" data-pv-product-ai-state>Studio pronto</span>
        <button class="pv-product-blank-project" type="button" data-action="new-project">Novo projeto vazio</button>
      </div>
    </div>
    <label class="pv-product-prompt-wrap">
      <span class="sr-only">Direção musical</span>
      <textarea data-pv-product-prompt rows="5" maxlength="4000" placeholder="Ex.: R&B brasileiro 2000s, sensual e noturno; baixo synth profundo, bateria humana, refrão grande, voz masculina próxima; sem trap e sem dembow pesado…"></textarea>
    </label>
    <div class="pv-product-prompt-chips" aria-label="Direções rápidas">
      <button type="button" data-pv-product-preset="R&B brasileiro 2000s, sensual e noturno, grave redondo, synths escuros, bateria humana e refrão grande">R&B 2000s</button>
      <button type="button" data-pv-product-preset="Pop funk brasileiro elegante, groove chiclete, baixo synth e refrão imediato, sem batestaca excessiva">Pop funk</button>
      <button type="button" data-pv-product-preset="Pop R&B moderno, elegante e dançante, synths gloss, pads e motivo melódico memorável">Pop R&B</button>
    </div>
    <div class="pv-product-create-actions">
      <button class="pv-product-primary" type="button" data-route="compose" data-pv-product-create="song"><span>✦</span><b>Música com voz</b><small>letra + voz cantada + produção + versões</small></button>
      <button class="pv-product-secondary" type="button" data-route="compose" data-pv-product-create="instrumental"><span>▥</span><b>Instrumental</b><small>produção completa sem vocal</small></button>
    </div>
  </div>

  <div class="pv-product-bottom-row pv-product-song-row">
    <button class="pv-product-project-card" type="button" data-route="projects">
      <div><span>SUAS MÚSICAS</span><b data-pv-product-project-title>Meus projetos</b><small data-pv-product-project-copy>Abra uma música e continue exatamente de onde parou.</small></div><i>→</i>
    </button>
    <button class="pv-product-project-card pv-product-studio-card" type="button" data-route="studio">
      <div><span>STUDIO</span><b>Continuar produzindo</b><small>Seções, voz, pistas, mix e exportação no mesmo projeto.</small></div><i>→</i>
    </button>
    <button class="pv-product-pablo-card" type="button" data-route="pablo">
      <div class="pv-product-pablo-orb">PV</div><div><span>PABLO</span><b>Companheiro criativo</b><small>Peça mudanças em linguagem normal sem sair da música.</small></div><i>→</i>
    </button>
  </div>`;
}

function syncHomeState(surface) {
  const projectButton = document.querySelector('.pv-project-now');
  const title = projectButton?.querySelector('b')?.textContent?.trim();
  const copy = projectButton?.querySelector('small')?.textContent?.trim();
  if (title) setText(surface.querySelector('[data-pv-product-project-title]'), title);
  if (copy) setText(surface.querySelector('[data-pv-product-project-copy]'), copy);
  const ai = surface.querySelector('[data-pv-product-ai-state]');
  if (ai) {
    const online = navigator.onLine !== false;
    ai.classList.toggle('online', online);
    setText(ai, online ? 'Criação conectada' : 'Projeto local disponível');
  }
}

function decorateCreate() {
  delete document.documentElement.dataset.pvProductHome;
  const main = document.querySelector('main');
  const creator = main?.querySelector('#pv-song-creator');
  if (!main || !creator) return;
  creator.dataset.pvProductCreator = 'true';
  applyPendingCreateIntent(creator);
}

function applyPendingCreateIntent(creator) {
  const form = creator.querySelector('[data-song-create-form]');
  if (!form || form.dataset.pvProductIntentApplied === 'true') return;
  const prompt = sessionStorage.getItem(PROMPT_KEY) || '';
  const kind = sessionStorage.getItem(KIND_KEY) || '';
  const brief = form.elements.brief;
  if (brief && prompt) {
    brief.value = prompt;
    brief.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (kind === 'instrumental' && form.elements.instrumentalFirst) {
    form.elements.instrumentalFirst.checked = true;
    form.elements.instrumentalFirst.dispatchEvent(new Event('change', { bubbles: true }));
    const button = form.querySelector('[data-pv-kind="instrumental"]');
    button?.click();
  }
  sessionStorage.removeItem(PROMPT_KEY);
  sessionStorage.removeItem(KIND_KEY);
  form.dataset.pvProductIntentApplied = 'true';
}

function decorateStudio() {
  delete document.documentElement.dataset.pvProductHome;
  const root = document.documentElement;
  root.dataset.pvStudioCut = STUDIO_CUT;
  const main = document.querySelector('main');
  if (!main) return;
  main.dataset.pvStudioFirstCut = 'true';
  const hero = main.querySelector('.pv-hero');
  if (hero) hero.dataset.pvProductHero = 'true';
  const transport = main.querySelector('.pv-transport-card');
  if (transport) transport.dataset.pvStudioCore = 'player';
  const actions = main.querySelector('.pv-studio-actions');
  if (actions) {
    actions.dataset.pvProductStudioActions = 'true';
    actions.querySelector('[data-action="import"]')?.setAttribute('data-pv-studio-core-action', 'import');
    actions.querySelector('[data-action="record"]')?.setAttribute('data-pv-studio-core-action', 'record');
    actions.querySelector('[data-action="save"]')?.setAttribute('data-pv-studio-core-action', 'save');
    actions.querySelector('[data-action="export"]')?.setAttribute('data-pv-studio-core-action', 'export');
  }
  const tabs = main.querySelector('.pv-tabs');
  if (!tabs) return;
  tabs.dataset.pvProductTabs = 'true';
  tabs.dataset.pvStudioCore = 'finish-song';
  const labels = { edit: 'Música', voice: 'Voz', mixer: 'Mix', export: 'Exportar' };
  for (const [value, label] of Object.entries(labels)) {
    const tab = tabs.querySelector(`[data-action="studio-tab"][data-value="${value}"]`);
    if (!tab) continue;
    tab.dataset.pvStudioCoreTab = value;
    setText(tab, label);
  }
}

function onClick(event) {
  const preset = event.target.closest('[data-pv-product-preset]');
  if (preset) {
    event.preventDefault();
    const textarea = document.querySelector('[data-pv-product-prompt]');
    if (textarea) {
      textarea.value = preset.dataset.pvProductPreset || '';
      textarea.focus();
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return;
  }
  const create = event.target.closest('[data-pv-product-create], [data-pv-product-intent]');
  if (create) {
    const prompt = document.querySelector('[data-pv-product-prompt]')?.value?.trim() || '';
    if (prompt) sessionStorage.setItem(PROMPT_KEY, prompt);
    sessionStorage.setItem(KIND_KEY, create.dataset.pvProductCreate || create.dataset.pvProductIntent || 'song');
  }
  queueSync();
}

function setText(node, value) {
  const text = String(value ?? '');
  if (node && node.textContent !== text) node.textContent = text;
}

installPabloVoiceProductUI();

export const PABLOVOICE_PRODUCT_UI_VERSION = PRODUCT_UI_VERSION;
export const PABLOVOICE_STUDIO_CUT = STUDIO_CUT;