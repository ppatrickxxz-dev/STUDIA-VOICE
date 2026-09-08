const ROUTES = Object.freeze({
  home: 'home',
  create: 'compose',
  pablo: 'pablo',
  lyrics: 'compose',
  beat: 'studio',
  instrument: 'studio',
  vocal: 'studio',
  record: 'studio',
  mixer: 'studio',
  arrangement: 'studio',
  master: 'studio',
  export: 'studio',
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
  });
  const legacy = shell.nextElementSibling;
  if (legacy?.classList?.contains('pv-nav')) legacy.dataset.pvLegacyNav = 'true';
}

function stopDuplicateLegacyRouting(event) {
  const command = event.target.closest('[data-vnext-canonical-nav] [data-vnext-command]');
  if (!command) return;
  // The vNext product shell already delegates the action to the canonical module/route.
  // Keep the underlying app route listener from processing the same click a second time.
  event.stopPropagation();
}

export const PABLOVOICE_VNEXT_ROUTE_POLICY = Object.freeze({
  canonicalVisibleNav: true,
  legacyNavHidden: true,
  delegatesToExistingRoutes: true,
});
