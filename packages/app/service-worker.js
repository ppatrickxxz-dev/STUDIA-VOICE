const CACHE = 'pablovoice-shell-v2.4.0-rc.1';
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
    .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((hit) => hit || caches.match('./index.html'))));
});

