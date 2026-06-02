const CACHE_NAME = 'vns-offline-v4';
const MEDIA_CACHE = 'vns-media-v4';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(['/','/index.html','/ico.png','/manifest.webmanifest']))
  );
});

self.addEventListener('activate', (event) => {
  // Delete ALL old caches when a new SW version activates
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== MEDIA_CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Bypasar Cache para los Audio Streams (para evitar que Range Requests de 206 parcial se rompan por el SW)
  if (url.pathname.includes('/api/downloads/') && url.pathname.endsWith('/stream')) {
    return; // Passthrough absoluto, dejando que Chrome use su cache nativo de multimedia
  }

  if (event.request.method === 'GET' && event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseToCache));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // UI Assets and other GET requests (Network First strategy)
  if (event.request.method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('chrome-extension')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || (response.type !== 'basic' && response.type !== 'cors')) {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        return caches.match(event.request, { ignoreSearch: true });
      })
    );
  }
});
