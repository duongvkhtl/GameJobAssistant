// Service worker: chạy offline (vỏ ứng dụng cache), dữ liệu ưu tiên mạng, đồng bộ nền định kỳ nếu trình duyệt hỗ trợ.
const VERSION = 'v2';
const SHELL = ['./', 'index.html', 'config.js', 'styles.css', 'app.js', 'lib/logic.js', 'lib/db.js', 'lib/match.js', 'lib/notify.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/data/')) {
    e.respondWith(fetch(req).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); return r; }).catch(() => caches.match(req)));
    return;
  }
  // Vỏ ứng dụng: ưu tiên mạng để nhận bản mới, rơi về cache khi offline
  e.respondWith(fetch(req).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return r; }).catch(() => caches.match(req, { ignoreSearch: true })));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow(e.notification.data?.url || './'))));
});

// ---- Đồng bộ nền định kỳ (Chrome Android, PWA đã cài): so sánh dữ liệu mới với lần app mở gần nhất ----
function idbGet(key) {
  return new Promise((resolve) => {
    const open = indexedDB.open('gja', 1);
    open.onerror = () => resolve(undefined);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onsuccess = () => {
      const r = open.result.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    };
  });
}
self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'check-updates') return;
  e.waitUntil((async () => {
    const settings = await idbGet('settings');
    if (!settings?.notify) return;
    const seen = await idbGet('seen');
    if (!seen) return;
    const [g, j] = await Promise.all(['games', 'jobs'].map((n) => fetch(`data/${n}.json?t=${Date.now()}`, { cache: 'no-store' }).then((r) => r.json())));
    const newGames = g.items.filter((x) => x.kind === 'store' && !seen.games.includes(x.id));
    const newJobs = j.items.filter((x) => x.relevance >= 60 && !seen.jobs.includes(x.id));
    if (newGames.length) await self.registration.showNotification(`${newGames.length} game mới`, { body: newGames.slice(0, 3).map((x) => x.name).join(', '), icon: 'icons/icon-192.png', tag: 'bg-games' });
    if (newJobs.length) await self.registration.showNotification(`${newJobs.length} việc làm mới`, { body: newJobs.slice(0, 3).map((x) => `${x.title} – ${x.company}`).join('\n'), icon: 'icons/icon-192.png', tag: 'bg-jobs' });
  })());
});
