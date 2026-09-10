const PRODUCT_UI_VERSION = 'pablovoice_product_ui_v21';
const PROMPT_KEY = 'pablovoice.product.createPrompt';
const KIND_KEY = 'pablovoice.product.createKind';

const runtime = { observer: null, scheduled: false, frame: 0 };

export function installPabloVoiceProductUI() {
  if (runtime.observer) return disconnect;
  document.documentElement.dataset.pvProductUi = PRODUCT_UI_VERSION;
  runtime.observer = new MutationObserver(queueSync);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('click', onClick, true);
  window.addEventListener('hashchange', queueSync);
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
  // vNext owns the canonical navigation DOM. Product UI only marks it; it never
  // rewrites labels/order because doing so would make two observers fight over
  // the same nodes and can starve the browser event loop.
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
    surface.className = 'pv-product-home';
    surface.innerHTML = homeMarkup();
    hero.insertAdjacentElement('afterend', surface);
  }
  syncHomeState(surface);
}

function homeMarkup() {
  return `<div class="pv-product-create-card">
    <div class="pv-product-create-head">
      <div><span class="pv-product-eyebrow">SONG BRAIN 2.0</span><h1 class="pv-product-title">Crie a música. Produza de verdade.</h1><h2>O que você quer criar?</h2><p>Descreva como falaria com um produtor. O PabloVoice organiza a direção e leva para o motor musical.</p></div>
      <span class="pv-product-ai-state" data-pv-product-ai-state>IA de criação</span>
    </div>
    <label class="pv-product-prompt-wrap">
      <span class="sr-only">Direção musical</span>
      <textarea data-pv-product-prompt rows="4" maxlength="1200" placeholder="Ex.: R&B 2000s sensual, baixo synth redondo, bateria solta, versos íntimos e refrão grande; sem trap, sem dembow pesado…"></textarea>
    </label>
    <div class="pv-product-prompt-chips" aria-label="Atalhos de direção musical">
      <button type="button" data-pv-product-preset="R&B 2000s sensual, grave redondo, synths escuros, bateria solta e refrão grande">R&B 2000s</button>
      <button type="button" data-pv-product-preset="Pop funk brasileiro, groove chiclete, baixo synth e refrão imediato, sem batestaca excessiva">Pop funk</button>
      <button type="button" data-pv-product-preset="Pop R&B moderno, elegante e dançante, synths gloss, pads e motivo melódico memorável">Pop R&B</button>
    </div>
    <div class="pv-product-create-actions">
      <button class="pv-product-primary" type="button" data-route="compose" data-pv-product-create="song"><span>✦</span><b>Criar música com IA</b><small>letra + instrumental + guia + takes</small></button>
      <button class="pv-product-secondary" type="button" data-route="compose" data-pv-product-create="instrumental"><span>▥</span><b>Criar instrumental</b><small>groove + harmonia + arranjo</small></button>
    </div>
  </div>

  <div class="pv-product-workspace-grid">
    <button type="button" class="pv-product-workspace" data-route="compose"><span>01</span><div><b>Letra & direção</b><small>brief, estrutura, prosódia e Song DNA</small></div><i>→</i></button>
    <button type="button" class="pv-product-workspace" data-route="compose" data-pv-product-intent="instrumental"><span>02</span><div><b>Beat & instrumentos</b><small>groove, timbres e construção do instrumental</small></div><i>→</i></button>
    <button type="button" class="pv-product-workspace" data-route="studio"><span>03</span><div><b>Arranjo & seções</b><small>editar trechos e preservar takes bons</small></div><i>→</i></button>
    <button type="button" class="pv-product-workspace" data-action="record"><span>04</span><div><b>Gravar voz</b><small>ideia, guia, doubles e take final</small></div><i>●</i></button>
    <button type="button" class="pv-product-workspace" data-route="studio"><span>05</span><div><b>Voice Lab & mix</b><small>limpeza, pitch, timbre, A/B e mixer</small></div><i>→</i></button>
    <button type="button" class="pv-product-workspace" data-route="studio"><span>06</span><div><b>Stems, master & export</b><small>fechamento, versões e saída final</small></div><i>→</i></button>
  </div>

  <div class="pv-product-bottom-row">
    <button class="pv-product-project-card" type="button" data-route="projects">
      <div><span>PROJETOS</span><b data-pv-product-project-title>Seu catálogo</b><small data-pv-product-project-copy>Abra um projeto ou continue de onde parou.</small></div><i>→</i>
    </button>
    <button class="pv-product-pablo-card" type="button" data-route="pablo">
      <div class="pv-product-pablo-orb">PV</div><div><span>PABLO IA</span><b>Assistente dentro do projeto</b><small>Peça mudanças por seção sem decorar ferramenta.</small></div><i>→</i>
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
    setText(ai, online ? 'IA conectada ao Studio' : 'Modo local · projeto preservado');
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
  }
  sessionStorage.removeItem(PROMPT_KEY);
  sessionStorage.removeItem(KIND_KEY);
  form.dataset.pvProductIntentApplied = 'true';
}

function decorateStudio() {
  delete document.documentElement.dataset.pvProductHome;
  const main = document.querySelector('main');
  const hero = main?.querySelector('.pv-hero');
  if (hero) hero.dataset.pvProductHero = 'true';
  const tabs = main?.querySelector('.pv-tabs');
  if (tabs) tabs.dataset.pvProductTabs = 'true';
  const actions = main?.querySelector('.pv-studio-actions');
  if (actions) actions.dataset.pvProductStudioActions = 'true';
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
