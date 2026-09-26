// 最小限のPWA用 Service Worker (ネットワーク優先・オフライン時はキャッシュ)
const C = 'v1';
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; })
      .catch(() => caches.match(e.request))
  );
});
