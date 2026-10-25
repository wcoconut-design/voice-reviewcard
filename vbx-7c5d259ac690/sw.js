// VOICE BOX 폰 앱: 인터넷이 없어도 열리게 앱 파일을 저장해 두고, 직접 첨부한 이미지를 보여줍니다.
const VERSION = 'eef935b803';
const SHELL = `vb-shell-${VERSION}`;
const IMAGE_CACHE = 'vb-images';
const FILES = ["index.html","app.js","style.css","mobile.css","markdown.js","export-core.js","model.js","local-api.js","mobile.js","reviewcard.html","reviewcard-bridge.js","manifest.webmanifest","icons/icon-180.png","icons/icon-192.png","icons/icon.svg"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('vb-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const rel = url.pathname.slice(scope.pathname.length);
  // 직접 첨부한 이미지·리뷰카드
  if (rel.startsWith('images/')) {
    e.respondWith(caches.open(IMAGE_CACHE).then((c) => c.match(url.href)).then((r) => r || new Response('', { status: 404 })));
    return;
  }
  // 앱 파일: 저장해 둔 것을 먼저 보여주고, 뒤에서 새 버전을 받아둬요.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const key = rel === '' || rel === 'index.html' ? 'index.html' : rel;
    const hit = await cache.match(new URL(key, scope).href, { ignoreSearch: true });
    const net = fetch(req).then((r) => { if (r.ok && FILES.includes(key)) cache.put(new URL(key, scope).href, r.clone()); return r; }).catch(() => null);
    return hit || (await net) || new Response('오프라인이에요.', { status: 503 });
  })());
});
