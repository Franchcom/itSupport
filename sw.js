// Service Worker: haelt die App-Dateien fuer den Offline-Betrieb vor.
// Online wird immer zuerst das Netz gefragt (damit Updates sofort ankommen),
// offline die Kopie. Die API wird nie zwischengespeichert; die Kundendaten
// liegen verschluesselt im localStorage, nicht hier.

const CACHE = 'itsupport-shell-v2';
const SHELL = [
  '/',
  '/index.html',
  '/app.css',
  '/manifest.webmanifest',
  '/js/app.js',
  '/js/api.js',
  '/js/crypto.js',
  '/js/model.js',
  '/js/vault.js',
  '/js/blobstore.js',
  '/js/images.js',
  '/icons/icon.svg',
  '/icons/apple-touch-icon.png',
  '/icons/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(event.request, { ignoreSearch: true });
        if (hit) return hit;
        if (event.request.mode === 'navigate') return caches.match('/index.html');
        return Response.error();
      }),
  );
});
