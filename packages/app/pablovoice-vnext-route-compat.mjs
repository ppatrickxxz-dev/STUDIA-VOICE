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
  observer.observe(document.documentElement, { childList: true, subtree: true });
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
  nav.querySelectorAll('[data-vnext-command]').forEach((button) => {
    const route = ROUTES[button.dataset.vnextCommand];
    if (route) button.dataset.route = route;
    else button.removeAttribute('data-route');
  });
  ensureCanonicalRoute(nav, 'studio', '◉', 'Studio', nav.querySelector('[data-vnext-command="create"]'));
  ensureCanonicalRoute(nav, 'projects', '▤', 'Projetos', nav.querySelector('[data-route="studio"]'));

  const legacy = shell.nextElementSibling;
  if (legacy?.classList?.contains('pv-nav')) {
    legacy.dataset.pvLegacyNav = 'true';
    const activeRoute = legacy.querySelector('[data-route].active')?.dataset.route || null;
    nav.querySelectorAll('[data-route]').forEach((button) => button.classList.toggle('route-active', button.dataset.route === activeRoute));
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
  // The vNext product shell already delegates specialist commands and high-level routes.
  // Direct Studio/Projects buttons intentionally bubble into the canonical app router.
  event.stopPropagation();
}

export const PABLOVOICE_VNEXT_ROUTE_POLICY = Object.freeze({
  canonicalVisibleNav: true,
  includesStudioAndProjects: true,
  specialistCommandsAreNotFakeRoutes: true,
  legacyNavHidden: true,
  delegatesToExistingRoutes: true,
});
