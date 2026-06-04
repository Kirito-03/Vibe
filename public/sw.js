const CACHE_NAME = 'vns-offline-v5';
const MEDIA_CACHE = 'vns-media-v5';

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

  // Never intercept API requests — absolute passthrough to network.
  // This covers /api/downloads, /api/downloads/stream, POST /api/downloads, etc.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // Never intercept non-GET requests (POST, PUT, DELETE, PATCH).
  // These must always hit the network and never touch the cache.
  if (event.request.method !== 'GET') {
    return;
  }

  // Bypass chrome-extensions
  if (url.protocol.startsWith('chrome-extension') || url.pathname.startsWith('chrome-extension')) {
    return;
  }

  // Navigation requests: network-first, fallback to index.html
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', responseToCache));
          return response;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // UI Assets — Network First strategy.
  // NEVER cache: opaque responses, non-200 status, non-basic/cors types.
  // opaque responses always have status=0 and Cache.put() throws a network error.
  event.respondWith(
    fetch(event.request).then((response) => {
      if (
        !response ||
        response.status !== 200 ||
        response.type === 'opaque' ||
        (response.type !== 'basic' && response.type !== 'cors')
      ) {
        return response;
      }
      const responseToCache = response.clone();
      caches.open(CACHE_NAME).then((cache) => {
        cache.put(event.request, responseToCache).catch(() => {
          // Silently swallow cache write errors (quota exceeded, etc.)
        });
      });
      return response;
    }).catch(() => {
      return caches.match(event.request, { ignoreSearch: true });
    })
  );
});
