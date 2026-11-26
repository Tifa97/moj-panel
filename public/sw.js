/* Moj panel — service worker.
 *
 * Shell: network-first with a short timeout. Online you always get the
 *        current code; on a slow or dead network the cache answers within
 *        SHELL_TIMEOUT_MS. Stale-while-revalidate was a load behind, which
 *        is confusing both when developing and after a deploy.
 * Data:  network-first with a cache fallback, so a refreshed build shows up
 *        immediately but the app still opens offline.
 * /api/: network only, but mirrored into the data cache under the matching
 *        /data/ key so the offline fallback holds live data, not the build.
 */
const SHELL_TIMEOUT_MS = 1500;
const VERSION = 'v5';

/**
 * Everything is addressed relative to where sw.js lives, so the app works
 * both at the root (dev server) and under a path (GitHub Pages project
 * site, e.g. /CentralInfoPanel/).
 */
const BASE = new URL('./', self.location.href).pathname;
const under = (path, prefix) => path.startsWith(BASE + prefix);
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
  'js/notify.js',
  'js/places.js',
  'js/weather-codes.js',
  'js/views/shared.js',
  'js/views/dubrovnik.js',
  'js/views/hajduk.js',
  'js/views/weather.js',
  'js/views/events.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

/** Committed snapshots: the offline baseline before any live data arrives. */
const DATA_SEED = [
  'data/dubrovnik.json',
  'data/hajduk.json',
  'data/weather.json',
  'data/meta.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)),
      caches
        .open(DATA_CACHE)
        // Best effort: a missing snapshot must not block installation.
        .then((cache) => Promise.allSettled(DATA_SEED.map((f) => cache.add(f)))),
    ]).then(() => self.skipWaiting())
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

/** Tapping a match notification opens the app on the Hajduk panel. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './#hajduk', self.location.href).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const own = clients.find((c) => c.url.startsWith(self.registration.scope));
      if (own) {
        own.focus();
        // Same-origin links stay in the app; article links open a new tab.
        if (target.startsWith(self.registration.scope)) own.navigate(target).catch(() => {});
        else self.clients.openWindow(target);
        return;
      }
      return self.clients.openWindow(target);
    })
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

  // /api/ runs the collectors live, so it is never replayed from cache.
  // A successful answer is stored under the matching /data/ key, though:
  // when the server is gone the app falls back to that path, and this way
  // it gets the last live data instead of the last committed build.
  if (under(url.pathname, 'api/')) {
    event.respondWith(passThroughAndMirror(request, url));
    return;
  }

  if (under(url.pathname, 'data/')) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }

  // Navigations fall back to the cached shell when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL_CACHE).then((c) => c.put('index.html', copy));
          }
          return response;
        })
        .catch(() => caches.match('index.html', { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(shellRequest(request));
});

async function passThroughAndMirror(request, url) {
  const response = await fetch(request);
  if (response.ok) {
    const name = url.pathname.slice((BASE + 'api/').length);
    const mirror = new URL(`data/${name}`, self.location.href).toString();
    const cache = await caches.open(DATA_CACHE);
    await cache.put(mirror, response.clone());
  }
  return response;
}

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

/**
 * Race the network against a timer. Whatever the network returns is cached
 * either way, so a slow-but-successful fetch still freshens the cache for
 * next time.
 */
async function shellRequest(request) {
  const cache = await caches.open(SHELL_CACHE);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  const timeout = new Promise((resolve) => setTimeout(resolve, SHELL_TIMEOUT_MS, null));
  const winner = await Promise.race([network, timeout]);
  if (winner) return winner;

  const cached = await cache.match(request, { ignoreSearch: true });
  return cached || (await network) || fetch(request);
}
