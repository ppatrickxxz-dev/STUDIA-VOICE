import { installPabloVoiceCompanionReactor } from './pablovoice-companion-reactor-safe.mjs';

const ROUTES = Object.freeze({
  home: 'home',
  create: 'compose',
  pablo: 'pablo',
  lyrics: 'compose',
});

let observer = null;
let reactorCleanup = null;
let syncing = false;
let queued = false;

export function installPabloVoiceVNextRouteCompat() {
  if (observer) return teardown;
  observer = new MutationObserver(queueSync);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('click', stopDuplicateLegacyRouting, true);
  try {
    reactorCleanup = installPabloVoiceCompanionReactor();
  } catch (error) {
    console.error('PABLOVOICE_COMPANION_REACTOR_INSTALL_FAILED', error);
  }
  sync();
  return teardown;
}

function teardown() {
  observer?.disconnect();
  observer = null;
  document.removeEventListener('click', stopDuplicateLegacyRouting, true);
  reactorCleanup?.();
  reactorCleanup = null;
  syncing = false;
  queued = false;
}

function queueSync() {
  if (queued || syncing) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    sync();
  });
}

function sync() {
  if (syncing) return;
  syncing = true;
  try {
    const shell = document.querySelector('.pv-vnext-shell');
    const nav = shell?.querySelector('.pv-vnext-nav');
    if (!nav) return;

    nav.classList.add('pv-nav');
    nav.dataset.vnextCanonicalNav = 'true';

    const createAnchor = nav.querySelector('[data-vnext-command="create"], [data-vnext-route-command="create"]');
    nav.querySelectorAll('[data-vnext-command]').forEach((button) => {
      const command = button.dataset.vnextCommand;
      const route = ROUTES[command];
      if (route) {
        button.dataset.route = route;
        button.dataset.vnextRouteCommand = command;
        button.removeAttribute('data-vnext-command');
      } else {
        button.removeAttribute('data-route');
      }
    });

    ensureCanonicalRoute(nav, 'studio', '◉', 'Studio', createAnchor);
    ensureCanonicalRoute(nav, 'projects', '▤', 'Projetos', nav.querySelector('[data-route="studio"]'));

    const legacy = shell.nextElementSibling;
    if (legacy?.classList?.contains('pv-nav')) {
      legacy.dataset.pvLegacyNav = 'true';
      legacy.classList.remove('pv-nav');
      legacy.classList.add('pv-legacy-nav');
    }

    const activeRoute = legacy?.querySelector('[data-route].active')?.dataset.route
      || shell.dataset.vnextRoute
      || null;
    nav.querySelectorAll('[data-route]').forEach((button) => {
      const active = button.dataset.route === activeRoute;
      button.classList.toggle('route-active', active);
      button.classList.toggle('active', active);
    });

    shell.querySelectorAll('[data-vnext-online], [data-vnext-network]').forEach((node) => {
      if (node.textContent !== 'STUDIO') node.textContent = 'STUDIO';
      node.dataset.pvConnectivityHidden = 'true';
    });

    document.dispatchEvent(new CustomEvent('pablovoice:vnext-surface-ready', {
      detail: { route: activeRoute, navigation: 'canonical-vnext' },
    }));
  } finally {
    syncing = false;
  }
}

function ensureCanonicalRoute(nav, route, icon, label, after) {
  let button = nav.querySelector(`[data-vnext-direct-route="${route}"]`);
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.vnextDirectRoute = route;
    button.dataset.route = route;
    button.innerHTML = `<span>${icon}</span><b>${label}</b>`;
    if (after) after.insertAdjacentElement('afterend', button);
    else nav.appendChild(button);
  }
  return button;
}

function stopDuplicateLegacyRouting(event) {
  const command = event.target.closest('[data-vnext-canonical-nav] [data-vnext-command]');
  if (!command) return;
  event.stopPropagation();
}

export const PABLOVOICE_VNEXT_ROUTE_POLICY = Object.freeze({
  canonicalVisibleNav: true,
  singlePvNav: true,
  includesStudioAndProjects: true,
  specialistCommandsAreNotFakeRoutes: true,
  highLevelRoutesBubbleOnce: true,
  legacyNavHidden: true,
  delegatesToExistingRoutes: true,
  unifiedConnectivityLanguage: true,
  musicGraphCompanionReactor: true,
  browserSafeBeatMotion: true,
  fullDockMovesWithTempo: true,
  cspSafeReactionStyles: true,
  structuralObserverOnly: true,
});
