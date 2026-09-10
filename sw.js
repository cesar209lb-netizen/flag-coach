// Offline support: cache every app file on install, serve from cache first.
// Bump CACHE whenever any app file changes so iPads pick up the new version.

const CACHE = 'flagcoach-v17';
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './styles/app.css',
  './js/app.js', './js/ui.js', './js/db.js', './js/store.js', './js/model.js', './js/field.js',
  './js/sim.js', './js/stage.js', './js/photo.js', './js/backup.js', './js/sync.js', './js/qr.js',
  './js/views/home.js', './js/views/playbook.js', './js/views/editor.js', './js/views/huddle.js',
  './js/views/roster.js', './js/views/settings.js', './js/views/teamsync.js', './js/views/routelab.js',
  './icons/icon-180.png', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = (await cache.match(req, { ignoreSearch: true }))
      || (req.mode === 'navigate' ? await cache.match('./index.html') : undefined);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return Response.error();
    }
  })());
});
