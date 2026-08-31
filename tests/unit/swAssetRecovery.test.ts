// @vitest-environment node
//
// THE SERVICE WORKER, EXECUTED — not grepped.
//
// 2026-08-31: the deployed app served a BLANK PAGE. `index.html` named
// `/assets/index-BbT27NeX.js`, the file was on Vercel and answered 200 to
// curl, and the browser still got 404 — because a request made during the
// deploy window was answered 404, and `vercel.json` stamps `Cache-Control:
// public, max-age=31536000, immutable` on EVERY response under `/assets/`, a
// 404 included. The browser pinned that 404 for a year. The module never ran,
// `#root` stayed empty, and nothing on the page said so.
//
// A hashed filename is a PROMISE: the build that wrote it into the HTML also
// shipped the file. So a non-200 for one is a lie told by a cache, and the
// worker now refuses to accept it on first ask — it retries past every cache.
//
// `tests/unit/pwaAssets.test.ts` pins the worker's SHAPE by reading its text.
// That is what let this ship: every assertion there still passed while the app
// was blank. This file runs the fetch handler against a fake cache and a fake
// network instead, so the recovery is proven by behaviour.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SW_SRC = readFileSync(resolve(__dirname, '../../public/sw.js'), 'utf8');

interface FakeResponse { status: number; ok: boolean; type: string; body: string; clone(): FakeResponse }

function res(status: number, body = 'x'): FakeResponse {
  const r: FakeResponse = {
    status, ok: status >= 200 && status < 300, type: 'basic', body, clone: () => r,
  };
  return r;
}

type Keyed = { url?: string } | string;
const keyOf = (req: Keyed): string => (typeof req === 'string' ? req : req.url as string);

/** One `Cache`. Insertion-ordered, exactly like the real one, because the
 *  trimming this worker does relies on the oldest key coming back first. */
class FakeCache {
  store = new Map<string, FakeResponse>();
  async put(req: Keyed, r: FakeResponse) { this.store.set(keyOf(req), r); }
  async match(req: Keyed) { return this.store.get(keyOf(req)); }
  async keys() { return [...this.store.keys()].map((url) => ({ url })); }
  async delete(req: Keyed) { return this.store.delete(keyOf(req)); }
  async addAll() { /* the shell precache; not what this file is about */ }
}

interface Harness {
  handlers: Record<string, (e: unknown) => void>;
  cacheStore: Map<string, FakeCache>;
  calls: { url: string; init?: { cache?: string } }[];
  skipWaiting: number;
  respond(url: string, mode?: string): Promise<FakeResponse>;
}

/** Loads public/sw.js with `self`, `caches` and `fetch` supplied by hand. The
 *  worker reads them as free identifiers, so a Function wrapper is enough — no
 *  bundler, no jsdom, and the file under test is the file that ships. */
function load(network: (url: string, init?: { cache?: string }) => FakeResponse): Harness {
  const handlers: Record<string, (e: never) => void> = {};
  const cacheStore = new Map<string, FakeCache>();
  const calls: Harness['calls'] = [];
  let skipWaiting = 0;

  const caches = {
    async open(name: string) {
      if (!cacheStore.has(name)) cacheStore.set(name, new FakeCache());
      return cacheStore.get(name) as FakeCache;
    },
    async keys() { return [...cacheStore.keys()]; },
    async delete(name: string) { return cacheStore.delete(name); },
    async match(req: Keyed) {
      for (const cache of cacheStore.values()) {
        const hit = await cache.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const self = {
    location: { origin: 'https://gatepass-bay.vercel.app' },
    clients: { claim: async () => undefined },
    skipWaiting: () => { skipWaiting += 1; },
    addEventListener: (name: string, fn: (e: never) => void) => { handlers[name] = fn; },
  };

  const fetchFn = async (req: Keyed, init?: { cache?: string }) => {
    calls.push({ url: keyOf(req), init });
    return network(keyOf(req), init);
  };

  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'URL', SW_SRC)(self, caches, fetchFn, URL);

  return {
    handlers: handlers as Harness['handlers'],
    cacheStore,
    calls,
    get skipWaiting() { return skipWaiting; },
    respond(url: string, mode = 'no-cors') {
      let out!: Promise<FakeResponse>;
      (handlers.fetch as (e: unknown) => void)({
        request: { url, method: 'GET', mode },
        respondWith: (p: Promise<FakeResponse>) => { out = p; },
      });
      return out;
    },
  } as Harness;
}

const ASSET = 'https://gatepass-bay.vercel.app/assets/index-BbT27NeX.js';
const assetCacheOf = (h: Harness) => [...h.cacheStore.entries()]
  .find(([name]) => name.includes('assets'))?.[1];

async function fire(h: Harness, name: 'install' | 'activate'): Promise<void> {
  const waited: Promise<unknown>[] = [];
  (h.handlers[name] as (e: unknown) => void)({ waitUntil: (p: Promise<unknown>) => waited.push(p) });
  await Promise.all(waited);
}

describe('a hashed asset that 404s is a poisoned cache, not a missing file', () => {
  it('retries past every cache and serves the real file', async () => {
    let asked = 0;
    const h = load((_url, init) => {
      asked += 1;
      return init?.cache === 'reload' ? res(200, 'the real bundle') : res(404, 'NOT_FOUND');
    });

    const out = await h.respond(ASSET);

    expect(asked).toBe(2);
    expect(h.calls[1].init?.cache).toBe('reload');
    expect(out.status).toBe(200);
    expect(out.body).toBe('the real bundle');
  });

  it('caches only what the retry proved, never the 404', async () => {
    const h = load((_u, init) => (init?.cache === 'reload' ? res(200) : res(404)));
    await h.respond(ASSET);
    const cached = await (assetCacheOf(h) as FakeCache).match(ASSET);
    expect(cached?.status).toBe(200);
  });

  it('does not double-fetch when the first answer was fine', async () => {
    const h = load(() => res(200));
    await h.respond(ASSET);
    expect(h.calls).toHaveLength(1);
  });

  it('gives up rather than looping when the file is genuinely gone', async () => {
    const h = load(() => res(404));
    const out = await h.respond(ASSET);
    expect(out.status).toBe(404);
    expect(h.calls).toHaveLength(2);
    expect(assetCacheOf(h)?.store.size ?? 0).toBe(0);
  });
});

describe('the asset cache is bounded', () => {
  // The live worker had FORTY-EIGHT superseded bundles in it, 38 MB, because
  // nothing ever evicted a hashed filename the app had stopped naming.
  it('keeps the newest entries and drops the oldest', async () => {
    const h = load(() => res(200));
    for (let i = 0; i < 40; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await h.respond(`https://gatepass-bay.vercel.app/assets/index-${i}.js`);
    }
    const assets = assetCacheOf(h) as FakeCache;
    expect(assets.store.size).toBeLessThanOrEqual(24);
    expect(await assets.match('https://gatepass-bay.vercel.app/assets/index-39.js')).toBeTruthy();
    expect(await assets.match('https://gatepass-bay.vercel.app/assets/index-0.js')).toBeUndefined();
  });
});

describe('a fixed worker has to reach the browser that is already broken', () => {
  it('takes over on install rather than waiting for every tab to close', async () => {
    const h = load(() => res(200));
    await fire(h, 'install');
    expect(h.skipWaiting).toBe(1);
  });

  it('drops the caches of an older worker version on activate', async () => {
    const h = load(() => res(200));
    h.cacheStore.set('gatepass-assets-v1', new FakeCache());
    h.cacheStore.set('gatepass-shell-v1', new FakeCache());
    await fire(h, 'activate');
    expect([...h.cacheStore.keys()]).not.toContain('gatepass-assets-v1');
    expect([...h.cacheStore.keys()]).not.toContain('gatepass-shell-v1');
  });
});
