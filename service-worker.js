/* Offline-first PWA cache. Bump this version whenever bundled files change. */
const CACHE_VERSION = 'quran-reader-v42';
const CACHE_NAME = `${CACHE_VERSION}-precache`;
const CACHE_PREFIX = 'quran-reader-';
const AUDIO_CACHE_NAME = 'quran-reader-audio-v3';
const AUDIO_CACHE_VALIDITY_MS = 7 * 24 * 60 * 60 * 1000;
const APP_SHELL = '/index.html';
const PRECACHE_URLS = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest',
  '/data/quran-v14.json', '/data/tafsir-ibn-kathir-v1.json', '/data/recitation-timings-v1.json', '/assets/fonts/indopak-nastaleeq.woff2',
  '/assets/icon.svg', '/assets/icon-180.png', '/assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(PRECACHE_URLS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME && name !== AUDIO_CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function cachedAudioIsCurrent(response) {
  const downloadedAt = Date.parse(response?.headers?.get('X-Nur-Audio-Downloaded-At') || '');
  return Number.isFinite(downloadedAt)
    && downloadedAt <= Date.now()
    && Date.now() - downloadedAt < AUDIO_CACHE_VALIDITY_MS;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // QF metadata and streamed audio must never enter the general app-shell
  // cache. The app deliberately inserts offline MP3s into the dedicated cache
  // with a fresh-download timestamp; no audio cache entry survives past 7 days.
  if (url.pathname.startsWith('/api/qf/')) {
    if (/^\/api\/qf\/chapter-audio\/\d+\/\d+\/file$/.test(url.pathname)) {
      event.respondWith((async () => {
        const cache = await caches.open(AUDIO_CACHE_NAME);
        const cached = await cache.match(request);
        if (cached && cachedAudioIsCurrent(cached)) return cached;
        if (cached) await cache.delete(request);
        return fetch(request);
      })());
    }
    return;
  }

  const isAppShell = request.mode === 'navigate' || [
    '/', '/index.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/service-worker.js',
  ].includes(url.pathname);

  if (isAppShell) {
    event.respondWith((async () => {
      try {
        const networkResponse = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request.mode === 'navigate' ? APP_SHELL : request, networkResponse.clone());
        return networkResponse;
      } catch {
        return (await caches.match(request)) || (await caches.match(APP_SHELL)) || (await caches.match('/'));
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      return Response.error();
    }
  })());
});
