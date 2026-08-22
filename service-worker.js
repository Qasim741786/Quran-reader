const APP_CACHE = 'quran-reader-app-v1';
const DATA_CACHE = 'quran-reader-data-v1';
const APP_FILES = [
  './', './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './assets/icon.svg', './assets/icon-180.png', './assets/icon-512.png', './assets/fonts/indopak-nastaleeq.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isOfflineAsset = /data\/quran\.json|assets\/fonts/.test(url.pathname);
  if (isOfflineAsset) {
    event.respondWith(caches.open(DATA_CACHE).then(async (cache) => (await cache.match(event.request)) || cache.add(event.request).then(() => cache.match(event.request))));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(APP_CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
