/* माझी स्तोत्रे — service worker.
 * VERSION and ASSETS are written by tools_build_data.py (content hash of every precached file).
 * Do not edit them by hand: run `python3 tools_build_data.py` after changing any app file.
 */
const VERSION = '15fb09c02f6f';
const CACHE = 'stotre-' + VERSION;
const ASSETS = ["./", "./index.html", "./app.js", "./style.css", "./manifest.webmanifest", "./data/bhimrupi.json", "./data/catalog.json", "./data/ramraksha.json", "./covers/hanuman.svg", "./covers/ram.svg", "./covers/titles.json", "./fonts/NotoSerifDevanagari-Regular-subset.woff2", "./fonts/OFL-Gotu.txt", "./fonts/OFL.txt", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./reminders/bhimrupi-saturday-0700.ics", "./reminders/ramraksha-daily-1900.ics"];

self.addEventListener('install', (event) => {
  // cache: 'reload' bypasses the HTTP cache so a new version never stores stale files
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  // no skipWaiting() here: the page asks for it when the app is in the background (see app.js)
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => (k.startsWith('stotre-') || k.startsWith('bhakti-')) && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Google Calendar, licence links etc. go straight to the network
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      try { return await fetch(req); } catch (e) { if (shell) return shell; throw e; }
    }
    return fetch(req);
  })());
});
