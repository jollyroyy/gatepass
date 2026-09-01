/* Quest Gate Pass service worker — what makes the installed app open like an app.
 *
 * THREE STRATEGIES, PICKED BY WHAT THE REQUEST IS:
 *   navigation  → network-first, falling back to the cached shell. Network-first
 *                 is what keeps a deploy from being invisible: the HTML names
 *                 the hashed bundles, so serving it from cache would pin the app
 *                 to whatever version was installed first.
 *   /assets/*   → cache-first. Vite hashes these filenames, so a hit is the file
 *                 that filename will always mean, and a miss is a new build.
 *   everything  → stale-while-revalidate: the icons, the manifest, login-bg.jpg.
 *   else          Shown immediately, refreshed behind the screen.
 *
 * THERE IS NO NEVER-CACHE LIST, and that is a fact about this app rather than an
 * omission. The whole build is about 1.5 MB, so every strategy here is bounded
 * by something a phone can hold. (The sibling VMS worker carries one, because
 * that repo ships 52 MB of WASM and OCR weights under /ort/ and /models/. If
 * anything of that size ever lands in this public/ directory, this file needs
 * the same exclusion before it does.)
 *
 * IT NEVER TOUCHES ANOTHER ORIGIN. Supabase's REST, auth and realtime calls are
 * cross-origin and return early below — a cached auth response, or a cached list
 * of which passes are still awaiting approval, is worse than no service worker
 * at all. Nothing here makes the app work offline in any real sense; it makes it
 * LAUNCH offline, which is a different and much smaller promise.
 */

/* Bumped to v3 on 2026-09-01. The number is not decoration: `activate` deletes
 * every `gatepass-` cache that is not in CURRENT_CACHES, so raising it is the
 * one lever that makes a phone already holding this app throw its stored shell
 * and assets away. Any handset carrying a bad entry from the 2026-08-31 deploy
 * window loses it the moment this worker activates. */
const VERSION = 'v3';
const SHELL_CACHE = `gatepass-shell-${VERSION}`;
const ASSET_CACHE = `gatepass-assets-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];

/* How many hashed files the asset cache may hold. Every deploy renames all of
 * them, so without a ceiling this cache keeps one entry per build FOR EVER —
 * the live worker was found holding forty-eight superseded bundles, 38 MB, none
 * of them nameable by any HTML this app will ever serve again. A build is one
 * JS and one CSS, so twenty-four leaves a dozen deploys' worth of instant back
 * navigation and throws away the archaeology. */
const ASSET_CACHE_LIMIT = 24;

/* The document every navigation falls back to. A SPA has exactly one. */
const SHELL_URL = '/index.html';

/* Cached on install so the first launch after going offline still opens. It is
 * one document, and deliberately only one: the hashed bundles cannot be named
 * here and arrive on the first online load a moment later, while the manifest
 * and the icons are read by the browser at INSTALL time and by the launcher
 * from its own copy afterwards. */
const PRECACHE = [SHELL_URL];

/* `skipWaiting` is not impatience. A worker normally waits for every tab of the
 * app to close before it takes over, which is right when the change is a
 * feature and wrong when the change is a REPAIR: the browser that most needs
 * this worker is the one sitting on a blank page, and it will not close that
 * tab, it will reload it. Safe here because the only thing this worker chooses
 * between is hashed filenames, which never mean two different files. */
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)).catch(() => undefined),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((name) => name.startsWith('gatepass-') && !CURRENT_CACHES.includes(name))
          .map((name) => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

/** Only a plain, complete, same-origin 200 is worth keeping. A 206 is a range
 *  request, and an opaque response has a body this worker cannot inspect. */
function isStorable(response) {
  return Boolean(response) && response.status === 200 && response.type === 'basic';
}

async function putIfStorable(cacheName, request, response) {
  if (!isStorable(response)) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  if (cacheName === ASSET_CACHE) await trimCache(ASSET_CACHE, ASSET_CACHE_LIMIT);
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    // Keyed by SHELL_URL, not by the request: every route in this SPA is served
    // the same document, and caching each visited path separately would store
    // twenty copies of one file and still miss the twenty-first.
    await putIfStorable(SHELL_CACHE, SHELL_URL, response);
    return response;
  } catch (error) {
    const cached = await caches.match(SHELL_URL);
    if (cached) return cached;
    throw error;
  }
}

/** Drops the oldest entries once a cache is over its ceiling. `keys()` returns
 *  insertion order, so the front of the list is the least recently added. */
async function trimCache(cacheName, limit) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= limit) return;
  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}

/**
 * A hashed asset. Cache-first, and — the part that is not decoration — it does
 * not believe a failure the first time.
 *
 * A NON-200 FOR A HASHED FILENAME IS A LIE TOLD BY A CACHE. The filename came
 * out of the HTML the very same build wrote, so the file exists by
 * construction; what does not exist is a reason to trust a 404 for it. On
 * 2026-08-31 the deployed app served a blank page to every browser that had
 * asked for one of these URLs during the deploy window: the answer then was a
 * 404, `vercel.json` stamps `immutable, max-age=31536000` on everything under
 * `/assets/` whatever its status, and the browser held that 404 for a year.
 * curl saw 200. The page stayed empty.
 *
 * So one retry, with `cache: 'reload'`, which goes past the HTTP cache to the
 * origin. Exactly one: if the second answer is bad too the file really is gone,
 * and a loop would only turn a broken page into a broken page plus a hot phone.
 * Neither answer is cached unless it is a 200.
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await putIfStorable(ASSET_CACHE, request, response);
    return response;
  }

  const retried = await fetch(request.url, { cache: 'reload' });
  await putIfStorable(ASSET_CACHE, request, retried);
  return retried;
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then((response) => { void putIfStorable(ASSET_CACHE, request, response); return response; })
    .catch(() => undefined);
  const fresh = cached ?? await network;
  if (fresh) return fresh;
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') { event.respondWith(networkFirst(request)); return; }
  if (url.pathname.startsWith('/assets/')) { event.respondWith(cacheFirst(request)); return; }
  event.respondWith(staleWhileRevalidate(request));
});
