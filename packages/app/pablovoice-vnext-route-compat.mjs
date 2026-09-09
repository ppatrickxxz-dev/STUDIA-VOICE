import { installPabloVoiceCompanionReactor } from './pablovoice-companion-reactor.mjs';

const ROUTES = Object.freeze({
  home: 'home',
  create: 'compose',
  pablo: 'pablo',
  lyrics: 'compose',
});

let observer = null;
let reactorCleanup = null;

export function installPabloVoiceVNextRouteCompat() {
  if (observer) return teardown;
  observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('click', stopDuplicateLegacyRouting, true);
  try {
    reactorCleanup = installPabloVoiceCompanionReactor();
  } catch (error) {
    console.error('PABLOVOICE_COMPANION_REACTOR_INSTALL_FAILED', error);
  }
  ensureReactionMotionCompatibility();
  sync();
  return teardown;
}

function teardown() {
  observer?.disconnect();
  observer = null;
  document.removeEventListener('click', stopDuplicateLegacyRouting, true);
  reactorCleanup?.();
  reactorCleanup = null;
}

function ensureReactionMotionCompatibility() {
  if (document.querySelector('style[data-pv-companion-motion-compat]')) return;
  const style = document.createElement('style');
  style.dataset.pvCompanionMotionCompat = 'true';
  style.textContent = `
    .pv-vnext-visualizer[data-vnext-reactive="music-graph"].section-hit .pv-vnext-device-screen {
      animation: pvCompanionSectionHit var(--pv-companion-beat-ms) ease-out 1 !important;
    }
    @keyframes pvCompanionMusicBeat {
      0%,100% { transform:translate(-50%,-50%) scale(.99) rotate(-1deg); }
      28% { transform:translate(-50%,-56%) scale(1.065) rotate(1.5deg); }
      58% { transform:translate(-50%,-48%) scale(1.025) rotate(-.5deg); }
    }
  `;
  document.head.appendChild(style);
}

function sync() {
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
      // High-level navigation must bubble once into the canonical app router.
      // Removing the vNext command prevents runCommand -> forwardRoute -> same button recursion.
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

  // Connectivity is an executor detail, never a second PabloVoice product mode.
  shell.querySelectorAll('[data-vnext-online], [data-vnext-network]').forEach((node) => {
    if (node.textContent !== 'STUDIO') node.textContent = 'STUDIO';
    node.dataset.pvConnectivityHidden = 'true';
  });
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
  // Specialist buttons are delegated by the vNext shell and must not also be interpreted
  // as routes. High-level route buttons have data-vnext-route-command instead and bubble.
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
});
