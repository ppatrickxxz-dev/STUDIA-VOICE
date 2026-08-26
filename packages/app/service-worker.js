const CACHE = 'pablovoice-shell-v2.4.0-rc.1-r2';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './storage.mjs', './recording.mjs',
  './audio-engine.mjs', './manifest.webmanifest', './core/src/project.mjs',
  './audio/src/presets.mjs', './songwriting/src/analyzer.mjs',
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
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;

      // Only document navigations may fall back to the application shell.
      // Returning index.html for JS/CSS/module requests causes a MIME/parse failure
      // and leaves the static boot screen visible after refresh.
      if (event.request.mode === 'navigate') {
        const shell = await caches.match('./index.html') || await caches.match('./');
        if (shell) return shell;
      }
      throw error;
    }
  })());
});
