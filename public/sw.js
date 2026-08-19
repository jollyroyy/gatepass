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

const VERSION = 'v1';
const SHELL_CACHE = `gatepass-shell-${VERSION}`;
const ASSET_CACHE = `gatepass-assets-${VERSION}`;
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];

/* The document every navigation falls back to. A SPA has exactly one. */
const SHELL_URL = '/index.html';

/* Cached on install so the first launch after going offline still opens. It is
 * one document, and deliberately only one: the hashed bundles cannot be named
 * here and arrive on the first online load a moment later, while the manifest
 * and the icons are read by the browser at INSTALL time and by the launcher
 * from its own copy afterwards. */
const PRECACHE = [SHELL_URL];

self.addEventListener('install', (event) => {
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

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  await putIfStorable(ASSET_CACHE, request, response);
  return response;
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
