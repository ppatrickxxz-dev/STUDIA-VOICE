const STUDIA_UI = 'studia_voice_usability_v1';
const PRIMARY_ROUTES = Object.freeze([
  ['home', '✦', 'Criar'],
  ['studio', '◉', 'Studio'],
  ['projects', '▤', 'Projetos'],
  ['pablo', 'PV', 'Pablo'],
]);

const runtime = { observer: null, queued: false };

export function installStudiaVoiceCanonicalUI() {
  if (runtime.observer) return teardown;
  document.documentElement.dataset.pvStudiaUi = STUDIA_UI;
  runtime.observer = new MutationObserver((records) => {
    if (records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => node.nodeType === Node.ELEMENT_NODE))) queueSync();
  });
  runtime.observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('pablovoice:vnext-surface-ready', queueSync);
  document.addEventListener('pablovoice:vnext-ui-synced', queueSync);
  window.addEventListener('hashchange', queueSync);
  queueSync();
  return teardown;
}

function teardown() {
  runtime.observer?.disconnect();
  runtime.observer = null;
  runtime.queued = false;
  document.removeEventListener('pablovoice:vnext-surface-ready', queueSync);
  document.removeEventListener('pablovoice:vnext-ui-synced', queueSync);
  window.removeEventListener('hashchange', queueSync);
}

function queueSync() {
  if (runtime.queued) return;
  runtime.queued = true;
  queueMicrotask(() => {
    runtime.queued = false;
    syncCanonicalUI();
  });
}

function syncCanonicalUI() {
  document.documentElement.dataset.pvStudiaUi = STUDIA_UI;
  const shell = document.querySelector('.pv-vnext-shell');
  const nav = shell?.querySelector('[data-vnext-canonical-nav], .pv-vnext-nav');
  if (!shell || !nav) return;

  shell.dataset.pvStudiaShell = 'music-first';
  nav.dataset.pvStudiaNav = 'music-first';
  normalizeBrand(shell);
  hideLegacyAndDecorativeSurfaces(shell);
  normalizePrimaryNavigation(nav);
  normalizeProjectHeader(shell);
  tuneCreatorForm();
  markScreen(shell);
}

function normalizeBrand(shell) {
  const brand = shell.querySelector('.pv-vnext-brand');
  if (!brand) return;
  setText(brand.querySelector('b'), 'PabloVoice');
  setText(brand.querySelector('small'), 'STUDIA VOICE');
  brand.dataset.pvStudiaBrand = 'true';
}

function hideLegacyAndDecorativeSurfaces(shell) {
  const legacy = document.querySelector('.pv-legacy-nav');
  if (legacy) {
    legacy.hidden = true;
    legacy.inert = true;
    legacy.setAttribute('aria-hidden', 'true');
    legacy.dataset.pvStudiaLegacyEngineNav = 'true';
  }

  for (const selector of ['[data-vnext-brain]', '[data-vnext-companion-dock]', '[data-vnext-visualizer]']) {
    shell.querySelectorAll(selector).forEach((node) => {
      node.hidden = true;
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
      node.dataset.pvStudiaAuxiliary = 'hidden';
    });
  }

  document.querySelectorAll('#pv-intimate-home, .pv-home-grid, .pv-cap-card, .pv-companion-card').forEach((node) => {
    node.dataset.pvStudiaLegacySurface = 'true';
    node.hidden = true;
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
  });
}

function normalizePrimaryNavigation(nav) {
  const buttons = [...nav.querySelectorAll(':scope > button[data-route], :scope > button[data-vnext-route-command]')];
  const byRoute = new Map();
  for (const button of buttons) {
    const route = button.dataset.route || routeForCommand(button.dataset.vnextRouteCommand);
    if (route && !byRoute.has(route)) byRoute.set(route, button);
  }

  const home = byRoute.get('home');
  const studio = byRoute.get('studio');
  const projects = byRoute.get('projects');
  const pablo = byRoute.get('pablo');
  const primary = [home, studio, projects, pablo].filter(Boolean);

  nav.querySelectorAll(':scope > button, :scope > details, :scope > .pv-vnext-nav-sep').forEach((node) => {
    const keep = primary.includes(node);
    node.hidden = !keep;
    node.classList.toggle('pv-studia-hidden', !keep);
    if (!keep) {
      node.inert = true;
      node.setAttribute('aria-hidden', 'true');
    } else {
      node.inert = false;
      node.removeAttribute('aria-hidden');
    }
  });

  const labels = new Map(PRIMARY_ROUTES.map(([route, icon, label]) => [route, { icon, label }]));
  for (const button of primary) {
    const route = button.dataset.route;
    const spec = labels.get(route);
    if (!spec) continue;
    setText(button.querySelector('span'), spec.icon);
    setText(button.querySelector('b'), spec.label);
    button.dataset.pvPrimaryRoute = route;
  }

  const current = [...nav.children].filter((node) => primary.includes(node));
  const alreadyOrdered = primary.length === current.length && primary.every((node, index) => current[index] === node);
  if (!alreadyOrdered) for (const button of primary) nav.appendChild(button);
  nav.dataset.pvStudiaPrimaryOrder = 'home,studio,projects,pablo';
}

function routeForCommand(command) {
  if (command === 'create') return 'compose';
  if (command === 'lyrics') return 'compose';
  return command || '';
}

function normalizeProjectHeader(shell) {
  const meta = shell.querySelector('[data-vnext-project-meta]');
  if (!meta) return;
  const tools = meta.querySelector('.pv-vnext-top-tools');
  if (tools) tools.hidden = true;
  const label = meta.querySelector('small');
  if (label) setText(label, 'PROJETO');
}

function tuneCreatorForm() {
  const form = document.querySelector('#pv-song-creator [data-song-create-form]');
  if (!form) return;

  const duration = form.elements.duration;
  if (duration && !duration.querySelector('option[value="200"]')) {
    const option = document.createElement('option');
    option.value = '200';
    option.textContent = '3:20 · música completa';
    duration.appendChild(option);
  }
  if (duration && form.dataset.pvDurationDefaulted !== 'true') {
    if (duration.value === '120') duration.value = '200';
    form.dataset.pvDurationDefaulted = 'true';
  }

  const genre = form.elements.genre;
  if (genre && !genre.querySelector('option[value="pagofunk"]')) {
    const option = document.createElement('option');
    option.value = 'pagofunk';
    option.textContent = 'Pagofunk / Pagode + Funk';
    genre.appendChild(option);
  }

  const fieldset = form.querySelector('.pv-song-vocal-profile');
  if (fieldset) {
    setText(fieldset.querySelector('legend'), 'Voz');
    const helper = fieldset.querySelector(':scope > p');
    if (helper) setText(helper, 'Escolha a identidade geral da voz-guia. A música continua editável depois.');
    for (const name of ['lowMidi', 'highMidi', 'vocalLanguage']) {
      const control = fieldset.querySelector(`[name="${name}"]`);
      const label = control?.closest('label');
      if (label) {
        label.hidden = true;
        label.dataset.pvAdvancedVoiceControl = 'true';
      }
    }
    const falsetto = fieldset.querySelector('[name="falsetto"]')?.closest('label');
    if (falsetto) {
      falsetto.hidden = true;
      falsetto.dataset.pvAdvancedVoiceControl = 'true';
    }
  }

  const button = form.querySelector('[data-song-create-hq]');
  if (button && !button.disabled) setText(button, '✦ Criar versão');
  const modeCard = form.querySelector('.pv-song-mode-card');
  if (modeCard) {
    setText(modeCard.querySelector('strong'), 'Gerar música');
    setText(modeCard.querySelector('span'), 'Cria uma versão completa com a letra, a direção e a estrutura deste projeto.');
  }
  const status = form.querySelector('#pv-song-create-status');
  if (status && !/criando|fila|gpu|gerando|conectando|pronto|conclu/i.test(status.textContent || '')) {
    setText(status, 'Revise a letra e a direção. Quando estiver bom, crie uma versão completa.');
  }
  form.dataset.pvUsabilityTuned = 'true';
}

function markScreen(shell) {
  const actualRoute = document.querySelector('.pv-legacy-nav [data-route].active')?.dataset.route
    || shell.querySelector('[data-vnext-canonical-nav] [data-route].active')?.dataset.route
    || shell.dataset.vnextRoute
    || 'home';
  const visualRoute = actualRoute === 'compose' ? 'home' : actualRoute;
  document.documentElement.dataset.pvStudiaScreen = actualRoute;
  shell.querySelectorAll('[data-pv-primary-route]').forEach((button) => {
    const isActive = button.dataset.pvPrimaryRoute === visualRoute;
    button.classList.toggle('active', isActive);
    button.classList.toggle('route-active', isActive);
  });
  normalizeScreenCopy(actualRoute);
}

function normalizeScreenCopy(route) {
  const hero = document.querySelector('main > .pv-hero.compact, main > .pv-hero');
  if (!hero) return;
  const kicker = hero.querySelector('.pv-kicker');
  const title = hero.querySelector('.pv-title');
  const lead = hero.querySelector('.pv-lead');
  if (route === 'studio') {
    setText(kicker, 'Studio');
    return;
  }
  const copy = {
    home: ['Criar', 'Faça uma música.', 'Comece pela ideia. Letra, versões, voz e produção continuam no mesmo projeto.'],
    compose: ['Composição', 'Letra e direção.', 'Defina o que deve acontecer na música e gere quando estiver pronto.'],
    projects: ['Biblioteca', 'Projetos', 'Abra uma música e continue exatamente do ponto em que parou.'],
    pablo: ['Produtor', 'Pablo', 'Peça uma mudança concreta no projeto sem procurar a ferramenta manualmente.'],
  }[route];
  if (!copy) return;
  setText(kicker, copy[0]);
  setText(title, copy[1]);
  setText(lead, copy[2]);
}

function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

installStudiaVoiceCanonicalUI();

export const STUDIA_VOICE_CANONICAL_UI = STUDIA_UI;
