/* Offline support: caches the app shell. No user data passes through here. */
/* Cache names keep the original 'inkyridion-' prefix so old caches are cleaned up; the vault database name is unchanged so existing records stay. */
const VERSION = 'inkyridion-v4-inskrypity';
const ASSETS = ['./', 'index.html', 'styles.css', 'lib.js', 'app.js', 'record.js', 'manifest.webmanifest', 'assets/icon-180.png', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/logo.webp', 'assets/logo-doc.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('inkyridion-') && k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await c.match('index.html') : null);
    const net = fetch(req).then(r => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('Offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
  }));
});
