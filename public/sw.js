/* Moj panel — service worker.
 *
 * Shell: stale-while-revalidate — instant from cache, refreshed in the
 *        background, so an edited file lands on the next load instead of
 *        waiting for a version bump.
 * Data:  network-first with a cache fallback, so a refreshed build shows up
 *        immediately but the app still opens offline.
 */
const VERSION = 'v1';
const SHELL_CACHE = `cip-shell-${VERSION}`;
const DATA_CACHE = `cip-data-${VERSION}`;

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/dom.js',
  'js/format.js',
  'js/openmeteo.js',
  'js/weather-codes.js',
  'js/views/shared.js',
  'js/views/dubrovnik.js',
  'js/views/hajduk.js',
  'js/views/weather.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('cip-') && k !== SHELL_CACHE && k !== DATA_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Live forecast: always try the network, but keep the last good answer.
  if (url.hostname === 'api.open-meteo.com') {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes('/data/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // Navigations fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreSearch: true });

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || (await network) || fetch(request);
}
