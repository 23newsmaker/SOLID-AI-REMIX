// Service worker konservatif: hanya cache aset statis publik.
// Tidak pernah cache API, auth, foto, pengetahuan, atau URL bertanda tangan.
const CACHE = 'sar-static-v2';
const STATIC = ['icon.svg', 'logo.svg', 'manifest.webmanifest', 'offline.html',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png']
  .map((path) => new URL(path, self.registration.scope).pathname);
const OFFLINE = new URL('offline.html', self.registration.scope).pathname;
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('sar-static-') && k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.search) return;
  // Private pages remain network-only. Only a generic, public offline notice is
  // returned on network failure: never cache HTML, API responses or user media.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.open(CACHE).then((c) => c.match(OFFLINE))));
    return;
  }
  if (STATIC.includes(url.pathname)) e.respondWith(caches.open(CACHE).then((c) => c.match(req)).then((r) => r || fetch(req)));
});
