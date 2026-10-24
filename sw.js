// Service worker: lets Home Menu be installed to a home screen.
// It always tries the network first, so updates appear straight away. Same-site files are kept
// only as a fallback when there is no connection. Supabase data is never cached here.
const CACHE = 'home-menu-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((hit) => hit || new Response('Offline', { status: 503 })))
  );
});
