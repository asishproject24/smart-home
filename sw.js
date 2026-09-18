/* Smart Home Control System — Service Worker
   Caches the app shell so the dashboard installs & opens offline.
   API calls always go to the network (fresh data), never cached. */
const CACHE = 'smarthome-v2';
const SHELL = [
  '/', '/index.html', '/styles.css', '/script.js',
  '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;             // only cache GETs

  // Live data: always network (dashboard falls back to simulation offline).
  if (url.pathname.startsWith('/api/')) return;

  // App shell: cache-first, then network, and keep the cache fresh.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request).then((res) => {
        if (res && res.status === 200 && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
