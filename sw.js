// Fixifoot demo – network-first service worker (offline fallback to last cached copy)
const CACHE = 'fixifoot-demo-v14';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  // Only same-origin GET page assets. Never cache API / auth / cloud calls (those are cross-origin anyway)
  // and never cache POST/PUT or Range requests, so a sign-in or a file download cannot be served stale.
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (req.headers.has('range')) return;
  const dest = req.destination;
  if (dest === 'document' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(req, c)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
});
