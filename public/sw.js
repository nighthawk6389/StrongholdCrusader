/* Offline support: the game shell and its hashed assets are cached so it starts without a network.
 * Pages: network first (fresh builds win), cached copy when offline. Hashed /assets/: cache first
 * (their names change with every build). On install, the current build's assets are fetched up front;
 * on activate, assets from older builds are dropped. */
const CACHE = 'siege-cache-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
let current = [];

async function assetsOf(html) {
  return [...new Set(html.match(/\/assets\/[^"'\s)]+/g) ?? [])];
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('/', { cache: 'no-cache' });
      const html = await res.clone().text();
      current = await assetsOf(html);
      await cache.put('/', res);
      await cache.addAll([...SHELL.filter((u) => u !== '/'), ...current]);
      await self.skipWaiting();
    })().catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== CACHE) await caches.delete(name);
      if (current.length) {
        const cache = await caches.open(CACHE);
        for (const req of await cache.keys()) {
          const path = new URL(req.url).pathname;
          if (path.startsWith('/assets/') && !current.includes(path)) await cache.delete(req);
        }
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Fresh page when online (and keep it for offline); the cached shell otherwise.
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(async () => (await caches.match('/')) ?? Response.error()),
    );
    return;
  }
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
