// agenticFPV service worker: lets the game install to the home screen and run offline.
//
// This file is a template. The build (vite.config.ts) stamps in the build version and the list of files to
// precache, and emits it as dist/sw.js. A new build changes this file's bytes, so browsers see a new worker and swap the cache.
//
//  - install:  download every file of this build into a versioned cache, then take over straight away
//  - activate: delete caches from older builds, claim open pages
//  - fetch:    pages go network-first (fall back to the cached app shell when offline),
//              everything else cache-first. Only same-origin GET requests are handled.

const VERSION = '__VERSION__';
const FILES = __PRECACHE__;
const PREFIX = 'agenticfpv-';
const CACHE = PREFIX + VERSION;
const SCOPE = new URL('./', self.location).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 'reload' skips the HTTP cache so we store what the server has right now.
      await cache.addAll(FILES.map((f) => new Request(new URL(f, SCOPE).href, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  try {
    return await fetch(request);
  } catch {
    // Offline: any page address (including ?query) is the same single-page app.
    return (await caches.match(SCOPE)) || (await caches.match(request)) || Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
});
