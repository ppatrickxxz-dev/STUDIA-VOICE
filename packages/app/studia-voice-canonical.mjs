const STUDIA_UI = 'studia_voice_single_ui_v1';
const PRIMARY_ORDER = Object.freeze(['home', 'compose', 'studio', 'projects', 'pablo']);
const SPECIALISTS = Object.freeze([
  ['beat', '▦', 'Beat Lab'],
  ['instrument', '♬', 'Instrumentos'],
  ['vocal', '≋', 'Voz'],
  ['record', '●', 'Gravar'],
  ['mixer', '☷', 'Mixer'],
  ['arrangement', '↹', 'Arranjo'],
  ['master', '▥', 'Master'],
  ['export', '↥', 'Exportar'],
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

  shell.dataset.pvStudiaShell = 'canonical';
  nav.dataset.pvStudiaNav = 'canonical';
  normalizeBrand(shell);
  hideLegacySurfaces(shell);
  organizeSpecialistTools(nav);
  normalizePrimaryNavigation(nav);
  markScreen(shell);
}

function normalizeBrand(shell) {
  const brand = shell.querySelector('.pv-vnext-brand');
  if (!brand) return;
  const title = brand.querySelector('b');
  const sub = brand.querySelector('small');
  if (title && title.textContent !== 'PabloVoice') title.textContent = 'PabloVoice';
  if (sub && sub.textContent !== 'STUDIA VOICE · MUSIC STUDIO') sub.textContent = 'STUDIA VOICE · MUSIC STUDIO';
  brand.dataset.pvStudiaBrand = 'true';
}

function hideLegacySurfaces(shell) {
  const legacy = shell.nextElementSibling?.matches?.('.pv-legacy-nav')
    ? shell.nextElementSibling
    : document.querySelector('.pv-legacy-nav');
  if (legacy) {
    legacy.hidden = true;
    legacy.inert = true;
    legacy.setAttribute('aria-hidden', 'true');
    legacy.dataset.pvStudiaLegacyEngineNav = 'true';
  }
  document.querySelectorAll('#pv-intimate-home, .pv-home-grid, .pv-cap-card').forEach((node) => {
    node.dataset.pvStudiaLegacySurface = 'true';
    if (document.documentElement.dataset.pvProductRoute === 'home') {
      node.setAttribute('aria-hidden', 'true');
      node.inert = true;
    } else {
      node.removeAttribute('aria-hidden');
      node.inert = false;
    }
  });
}

function normalizePrimaryNavigation(nav) {
  const routeButtons = [...nav.querySelectorAll(':scope > [data-route]')];
  const tools = nav.querySelector(':scope > .pv-studia-tools');
  const byRoute = new Map(routeButtons.map((button) => [button.dataset.route, button]));

  const create = byRoute.get('compose');
  const createCommand = nav.querySelector(':scope > [data-vnext-route-command="create"]');
  const lyricsCommand = nav.querySelector(':scope > [data-vnext-route-command="lyrics"]');
  if (createCommand) {
    const label = createCommand.querySelector('b');
    if (label && label.textContent !== 'Criar') label.textContent = 'Criar';
  }
  if (lyricsCommand) {
    const label = lyricsCommand.querySelector('b');
    if (label && label.textContent !== 'Letras') label.textContent = 'Letras';
    lyricsCommand.dataset.pvStudiaSecondaryCompose = 'lyrics';
  }

  const home = byRoute.get('home');
  const studio = byRoute.get('studio');
  const projects = byRoute.get('projects');
  const pablo = byRoute.get('pablo');
  const ordered = [];
  for (const item of [home, createCommand || create, lyricsCommand, studio, projects, pablo]) {
    if (item && !ordered.includes(item)) ordered.push(item);
  }

  const current = [...nav.children].filter((node) => ordered.includes(node));
  const alreadyOrdered = ordered.length === current.length && ordered.every((node, index) => current[index] === node);
  if (!alreadyOrdered) {
    const anchor = tools || null;
    for (const button of ordered) nav.insertBefore(button, anchor);
  }
  nav.dataset.pvStudiaPrimaryOrder = PRIMARY_ORDER.join(',');
}

function organizeSpecialistTools(nav) {
  let details = nav.querySelector(':scope > .pv-studia-tools');
  if (!details) {
    details = document.createElement('details');
    details.className = 'pv-studia-tools';
    details.dataset.pvStudiaTools = 'true';
    details.innerHTML = '<summary>Ferramentas de produção</summary><div class="pv-studia-tools-grid"></div>';
    nav.appendChild(details);
  }
  const grid = details.querySelector('.pv-studia-tools-grid');
  for (const [command, icon, label] of SPECIALISTS) {
    let button = nav.querySelector(`:scope > [data-vnext-command="${command}"]`) || grid?.querySelector(`[data-vnext-command="${command}"]`);
    if (!button && grid) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.vnextCommand = command;
      button.innerHTML = `<span>${icon}</span><b>${label}</b>`;
    }
    if (!button || !grid) continue;
    const text = button.querySelector('b');
    if (text && text.textContent !== label) text.textContent = label;
    if (button.parentElement !== grid) grid.appendChild(button);
  }
  nav.querySelectorAll(':scope > .pv-vnext-nav-sep').forEach((separator) => separator.remove());
}

function markScreen(shell) {
  const route = document.querySelector('.pv-legacy-nav [data-route].active')?.dataset.route
    || shell.querySelector('[data-vnext-canonical-nav] [data-route].active')?.dataset.route
    || shell.dataset.vnextRoute
    || 'home';
  document.documentElement.dataset.pvStudiaScreen = route;
  shell.querySelectorAll('[data-route]').forEach((button) => {
    const isActive = button.dataset.route === route;
    button.classList.toggle('active', isActive);
    button.classList.toggle('route-active', isActive);
  });
  normalizeScreenCopy(route);
}

function normalizeScreenCopy(route) {
  const hero = document.querySelector('main > .pv-hero.compact');
  if (!hero) return;
  const kicker = hero.querySelector('.pv-kicker');
  const title = hero.querySelector('.pv-title');
  const lead = hero.querySelector('.pv-lead');
  if (route === 'projects') {
    setText(kicker, 'Biblioteca');
    setText(title, 'Projetos');
    setText(lead, 'Abra suas músicas e continue exatamente do ponto em que parou.');
  }
}

function setText(node, value) {
  if (node && node.textContent !== String(value)) node.textContent = String(value);
}

installStudiaVoiceCanonicalUI();

export const STUDIA_VOICE_CANONICAL_UI = STUDIA_UI;
