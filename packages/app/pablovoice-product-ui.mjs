const PRODUCT_UI_VERSION = 'pablovoice_product_ui_v31_music_first';
const PROMPT_KEY = 'pablovoice.product.createPrompt';
const KIND_KEY = 'pablovoice.product.createKind';
const STUDIO_CUT = 'song_completion_v2';

const runtime = { observer: null, scheduled: false, frame: 0 };

export function installPabloVoiceProductUI() {
  if (runtime.observer) return disconnect;
  document.documentElement.dataset.pvProductUi = PRODUCT_UI_VERSION;
  runtime.observer = new MutationObserver(queueSync);
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('click', onClick, true);
  window.addEventListener('input', queueSync, true);
  window.addEventListener('change', queueSync, true);
  window.addEventListener('hashchange', queueSync);
  window.addEventListener('online', queueSync);
  window.addEventListener('offline', queueSync);
  document.addEventListener('pablovoice:vnext-surface-ready', queueSync);
  document.addEventListener('pablovoice:project-updated', queueSync);
  document.addEventListener('pablovoice:song-created', queueSync);
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
  window.removeEventListener('input', queueSync, true);
  window.removeEventListener('change', queueSync, true);
  window.removeEventListener('hashchange', queueSync);
  window.removeEventListener('online', queueSync);
  window.removeEventListener('offline', queueSync);
  document.removeEventListener('pablovoice:vnext-surface-ready', queueSync);
  document.removeEventListener('pablovoice:project-updated', queueSync);
  document.removeEventListener('pablovoice:song-created', queueSync);
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
  else delete document.documentElement.dataset.pvProductHome;
  if (route === 'compose') decorateCreate();
  if (route === 'studio') decorateStudio();
}

function activeRoute() {
  return document.querySelector('.pv-legacy-nav [data-route].active')?.dataset.route ||
    document.querySelector('.pv-nav [data-route].active')?.dataset.route ||
    (document.querySelector('#lyrics') ? 'compose' : document.querySelector('.pv-transport-card') ? 'studio' : 'home');
}

function decorateNavigation() {
  const nav = document.querySelector('.pv-nav');
  if (nav) nav.dataset.pvProductNav = 'true';
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
  return `<div class="pv-product-create-card pv-product-create-card-v31">
    <div class="pv-product-create-head">
      <div>
        <span class="pv-product-eyebrow">STUDIA VOICE</span>
        <h1 class="pv-product-title">Faça uma música.</h1>
        <h2>Descreva o som que você quer.</h2>
        <p>Comece com uma ideia ou letra pronta. Tudo continua no mesmo projeto.</p>
      </div>
      <div class="pv-product-head-actions">
        <span class="pv-product-ai-state" data-pv-product-ai-state>Pronto</span>
        <button class="pv-btn" type="button" data-action="new-project">Novo projeto vazio</button>
      </div>
    </div>
    <label class="pv-product-prompt-wrap">
      <span class="sr-only">Direção musical</span>
      <textarea data-pv-product-prompt rows="5" maxlength="4000" placeholder="Ex.: pagofunk + R&B 2000s, masculino, íntimo, baixo melódico, tantã, pandeiro e refrão grande; sem trap."></textarea>
    </label>
    <div class="pv-product-prompt-chips" aria-label="Direções rápidas">
      <button type="button" data-pv-product-preset="R&B brasileiro 2000s, sensual, noturno, synth bass, bateria humana, voz masculina e refrão grande">R&B 2000s</button>
      <button type="button" data-pv-product-preset="Pagofunk íntimo, tantã, pandeiro, baixo melódico, R&B Y2K, funk carioca contido e voz masculina">Pagofunk</button>
      <button type="button" data-pv-product-preset="Pop R&B brasileiro, elegante, dançante, synths gloss, pads, baixo synth e refrão memorável">Pop R&B</button>
    </div>
    <div class="pv-product-create-actions">
      <button class="pv-product-primary" type="button" data-route="compose" data-pv-product-create="song"><span>✦</span><b>Criar música</b><small>letra · som · voz · gerar</small></button>
      <button class="pv-product-secondary" type="button" data-route="compose" data-pv-product-create="instrumental"><span>▥</span><b>Criar instrumental</b><small>sem voz cantada</small></button>
    </div>
  </div>
  <div class="pv-product-bottom-row pv-product-song-row">
    <button class="pv-product-project-card" type="button" data-route="projects">
      <div><span>PROJETOS</span><b data-pv-product-project-title>Abrir minhas músicas</b><small data-pv-product-project-copy>Continue de onde parou.</small></div><i>→</i>
    </button>
  </div>`;
}

function syncHomeState(surface) {
  const projectButton = document.querySelector('.pv-project-now');
  const title = projectButton?.querySelector('b')?.textContent?.trim();
  const copy = projectButton?.querySelector('small')?.textContent?.trim();
  if (title) {
    setText(surface.querySelector('[data-pv-product-project-title]'), `Continuar · ${title}`);
    if (copy) setText(surface.querySelector('[data-pv-product-project-copy]'), copy);
  }
  const ai = surface.querySelector('[data-pv-product-ai-state]');
  if (ai) {
    const online = navigator.onLine !== false;
    ai.classList.toggle('online', online);
    setText(ai, online ? 'Pronto' : 'Projeto local');
  }
}

function decorateCreate() {
  const main = document.querySelector('main');
  const lyrics = main?.querySelector('#lyrics');
  const creator = main?.querySelector('#pv-song-creator');
  if (!main || !lyrics || !creator) return;
  creator.dataset.pvProductCreator = 'true';
  applyPendingCreateIntent(creator);

  const lyricsCard = lyrics.closest('.pv-card');
  const lyricsGrid = lyricsCard?.parentElement;
  if (lyricsCard) lyricsCard.dataset.pvComposePrimary = 'lyrics';
  if (lyricsGrid) lyricsGrid.dataset.pvComposeLyricsGrid = 'true';

  hideOldComposer(main);
  collectWritingTools(main, lyricsCard, lyricsGrid, creator);
  ensureCreationFlow(main, lyricsGrid || lyricsCard || creator);
  syncCreationFlow(main, creator);
}

function hideOldComposer(main) {
  const oldComposer = main.querySelector('#pv-ai-composer');
  if (!oldComposer) return;
  oldComposer.hidden = true;
  oldComposer.inert = true;
  oldComposer.setAttribute('aria-hidden', 'true');
  oldComposer.dataset.pvSupersededComposer = 'true';
}

function collectWritingTools(main, lyricsCard, lyricsGrid, creator) {
  let details = main.querySelector('[data-pv-writing-tools]');
  if (!details) {
    details = document.createElement('details');
    details.className = 'pv-writing-tools';
    details.dataset.pvWritingTools = 'true';
    details.innerHTML = '<summary>Ferramentas de letra</summary><div data-pv-writing-tools-body></div>';
    creator.insertAdjacentElement('afterend', details);
  }
  const body = details.querySelector('[data-pv-writing-tools-body]');
  if (!body) return;

  const analysisCard = lyricsGrid ? [...lyricsGrid.children].find((node) => node !== lyricsCard && node.matches?.('.pv-card')) : null;
  if (analysisCard && analysisCard.parentElement !== body) body.appendChild(analysisCard);

  for (const grid of [...main.querySelectorAll(':scope > .pv-grid.equal.pv-panel-grid')]) {
    if (grid.contains(creator) || grid.contains(lyricsCard) || grid.closest('[data-pv-writing-tools]')) continue;
    const text = grid.textContent || '';
    if (/Mapa de linhas|Inteligência de rima|métrica|cantabilidade/i.test(text) && grid.parentElement !== body) body.appendChild(grid);
  }
}

function ensureCreationFlow(main, anchor) {
  let flow = main.querySelector('[data-pv-creation-flow]');
  if (!flow) {
    flow = document.createElement('div');
    flow.dataset.pvCreationFlow = 'true';
    flow.setAttribute('aria-label', 'Etapas da música');
    flow.innerHTML = '<span data-pv-flow-step="lyrics">1 · Letra</span><span data-pv-flow-step="sound">2 · Som</span><span data-pv-flow-step="voice">3 · Voz</span><span data-pv-flow-step="generate">4 · Gerar</span>';
    anchor.insertAdjacentElement('beforebegin', flow);
  }
}

function syncCreationFlow(main, creator) {
  const flow = main.querySelector('[data-pv-creation-flow]');
  if (!flow) return;
  const lyrics = String(main.querySelector('#lyrics')?.value || '').trim();
  const brief = String(creator.querySelector('[name="brief"]')?.value || '').trim();
  const result = creator.querySelector('#pv-song-create-result')?.children?.length > 0;
  const busy = /criando|fila|gpu|gerando|conectando/i.test(String(creator.querySelector('#pv-song-create-status')?.textContent || ''));
  let active = 'lyrics';
  if (result || busy) active = 'generate';
  else if (brief) active = 'voice';
  else if (lyrics) active = 'sound';
  flow.querySelectorAll('[data-pv-flow-step]').forEach((step) => step.classList.toggle('active', step.dataset.pvFlowStep === active));
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
