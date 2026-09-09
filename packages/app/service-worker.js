const CACHE = 'pablovoice-shell-v2.4.0-r11';
const SHELL = [
  './', './index.html', './styles.css', './preboot.mjs', './app.js', './storage.mjs', './recording.mjs',
  './audio-engine.mjs', './manifest.webmanifest', './core/src/project.mjs',
  './audio/src/presets.mjs', './audio/src/automation/region-restoration.mjs',
  './audio/src/analyzers/vocal-restoration.mjs', './songwriting/src/analyzer.mjs',
  './creator-unified-runtime.mjs', './pablovoice-unified-ui.css',
  './pablovoice-vnext-bootstrap.mjs', './pablovoice-vnext-ui.mjs', './pablovoice-vnext-route-compat.mjs',
  './pablovoice-companion-reactor.mjs', './pablovoice-vnext-ui.css', './pablovoice-vnext-compat.css', './pablovoice-vnext-unified.css',
  './project-context.mjs', './music-intelligence/src/project-music-graph.mjs', './music-intelligence/src/operation-router.mjs',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((key) => key.startsWith('pablovoice-shell-') && key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const networkRequest = event.request.mode === 'navigate'
        ? new Request(event.request, { cache: 'reload' })
        : event.request;
      let response = await fetch(networkRequest);
      if (response.status === 304) {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        response = await fetch(new Request(event.request, { cache: 'reload' }));
      }
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') {
        const shell = await caches.match('./index.html') || await caches.match('./');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
