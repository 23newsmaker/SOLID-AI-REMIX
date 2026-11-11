// Service worker konservatif: hanya cache aset statis publik.
// Tidak pernah cache API, auth, foto, pengetahuan, atau URL bertanda tangan.
const CACHE = 'sar-static-v1';
const STATIC = ['/icon.svg', '/logo.svg', '/manifest.webmanifest'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC))); self.skipWaiting(); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api') || url.search) return;
  if (STATIC.includes(url.pathname)) e.respondWith(caches.match(req).then((r) => r || fetch(req)));
});
