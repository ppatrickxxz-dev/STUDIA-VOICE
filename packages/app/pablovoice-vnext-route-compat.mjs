const ROUTES = Object.freeze({
  home: 'home',
  create: 'compose',
  pablo: 'pablo',
  lyrics: 'compose',
});

let observer = null;

export function installPabloVoiceVNextRouteCompat() {
  if (observer) return () => observer.disconnect();
  observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('click', stopDuplicateLegacyRouting, true);
  sync();
  return () => {
    observer?.disconnect();
    observer = null;
    document.removeEventListener('click', stopDuplicateLegacyRouting, true);
  };
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
});
