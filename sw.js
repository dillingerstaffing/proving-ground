// Proving Ground service worker.
// Bump VERSION whenever this file changes: the browser only installs a new
// worker when the bytes differ, and the page reloads itself on
// controllerchange, which is how stuck clients get unstuck automatically.
const VERSION = 'v20260916-1900';
const CACHE = 'proving-ground-' + VERSION;
const OFFLINE_URL = 'index.html';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('proving-ground-') && k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  // Version probes must always reach the network. A cached answer makes the
  // page's update check compare stale-to-stale and never reload.
  if (url.searchParams.has('vcheck')) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      // cache:'reload' skips the HTTP cache so a fresh launch always gets the
      // latest page instead of an up-to-10-minute-old copy.
      fetch(new Request(request, { cache: 'reload' }))
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
