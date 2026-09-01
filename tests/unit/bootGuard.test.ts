// @vitest-environment node
//
// THE BOOT GUARD — the thing that gets a browser off a blank page by itself.
//
// The service worker's retry (tests/unit/swAssetRecovery.test.ts) repairs the
// poisoned 404 described there, but it can only repair a request it is asked
// to handle, and the browser that is worst affected is the one whose HTTP
// cache holds the 404 while the OLD worker is still the one installed. That
// browser renders nothing at all, and it has no way of knowing it should
// reload — a blank page reports nothing to anybody.
//
// So `public/boot-guard.js` is a classic script that runs BEFORE the module
// bundle (CSP is `script-src 'self'`, so it cannot be inline). It watches for
// the two symptoms and, once per tab, re-fetches the assets the document names
// past the HTTP cache and reloads.
//
// ONCE PER TAB IS THE WHOLE SAFETY ARGUMENT: a repair that can fire twice on a
// genuinely broken deploy is a reload loop, which is worse than the blank page
// it is trying to fix.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = readFileSync(resolve(__dirname, '../../public/boot-guard.js'), 'utf8');

interface Env {
  listeners: Record<string, ((e: unknown) => void)[]>;
  timers: (() => void)[];
  fetched: { url: string; init?: { cache?: string } }[];
  unregistered: number;
  cachesDeleted: string[];
  reloads: number;
  session: Map<string, string>;
  rootChildren: number;
  fireError(url: string): void;
  runTimers(): void;
}

function boot(assets: string[], rootChildren = 0, opts: { swSupport?: boolean; cacheSupport?: boolean } = {}): Env {
  const listeners: Env['listeners'] = {};
  const timers: (() => void)[] = [];
  const fetched: Env['fetched'] = [];
  const session = new Map<string, string>();
  const env = { reloads: 0, rootChildren } as { reloads: number; rootChildren: number };
  const unregistered: { n: number } = { n: 0 };
  const cachesDeleted: string[] = [];

  // The order the repair must run in is what these two record. Both are
  // optional in the browser, so both are optional here.
  const navigatorStub = opts.swSupport === false ? {} : {
    serviceWorker: {
      getRegistrations: async () => [
        { unregister: async () => { unregistered.n += 1; return true; } },
      ],
    },
  };
  const cachesStub = opts.cacheSupport === false ? undefined : {
    keys: async () => ['gatepass-shell-v2', 'gatepass-assets-v2'],
    delete: async (name: string) => { cachesDeleted.push(name); return true; },
  };

  const addEventListener = (name: string, fn: (e: unknown) => void) => {
    (listeners[name] ||= []).push(fn);
  };
  const document = {
    querySelectorAll: () => assets.map((url) => ({ src: url, href: '' })),
    getElementById: () => ({ get childElementCount() { return env.rootChildren; } }),
  };
  const sessionStorage = {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => { session.set(k, v); },
  };
  const fetchFn = async (url: string, init?: { cache?: string }) => {
    fetched.push({ url, init });
    return { ok: true };
  };
  const location = { reload: () => { env.reloads += 1; } };
  const setTimeout = (fn: () => void) => { timers.push(fn); return 0; };

  // eslint-disable-next-line no-new-func
  new Function(
    'addEventListener', 'document', 'sessionStorage', 'fetch', 'location', 'setTimeout',
    'navigator', 'caches', SRC,
  )(addEventListener, document, sessionStorage, fetchFn, location, setTimeout,
    navigatorStub, cachesStub);

  return {
    listeners,
    timers,
    fetched,
    session,
    get unregistered() { return unregistered.n; },
    cachesDeleted,
    get reloads() { return env.reloads; },
    get rootChildren() { return env.rootChildren; },
    set rootChildren(n: number) { env.rootChildren = n; },
    fireError(url: string) {
      for (const fn of listeners.error ?? []) fn({ target: { src: url, href: '' } });
    },
    runTimers() {
      for (const fn of [...timers]) fn();
      timers.length = 0;
    },
  } as Env;
}

const BUNDLE = '/assets/index-BbT27NeX.js';
const CSS = '/assets/index-DWWdFMxN.css';
const flush = () => new Promise((r) => { setTimeout(r, 0); });

describe('a bundle that fails to load repairs itself', () => {
  it('re-fetches every asset past the HTTP cache, then reloads', async () => {
    const env = boot([BUNDLE, CSS]);
    env.fireError(BUNDLE);
    await flush();

    expect(env.fetched.map((f) => f.url)).toEqual([BUNDLE, CSS]);
    for (const f of env.fetched) expect(f.init?.cache).toBe('reload');
    expect(env.reloads).toBe(1);
  });

  it('ignores a failure that is not an app asset', async () => {
    const env = boot([BUNDLE]);
    env.fireError('https://example.test/tracker.gif');
    await flush();
    expect(env.fetched).toHaveLength(0);
    expect(env.reloads).toBe(0);
  });

  it('repairs at most once per tab — a second symptom must not loop', async () => {
    const env = boot([BUNDLE]);
    env.fireError(BUNDLE);
    await flush();
    env.fireError(BUNDLE);
    await flush();
    expect(env.reloads).toBe(1);
  });
});

describe('a bundle that loads but renders nothing', () => {
  it('repairs when #root is still empty after the wait', async () => {
    const env = boot([BUNDLE]);
    for (const fn of env.listeners.load ?? []) fn({});
    env.runTimers();
    await flush();
    expect(env.reloads).toBe(1);
  });

  // React mounts `FullPageLoader` while it resolves a session, so a rendered
  // app is never an empty #root. Anything in there means the bundle ran.
  it('leaves a page that rendered alone', async () => {
    const env = boot([BUNDLE], 1);
    for (const fn of env.listeners.load ?? []) fn({});
    env.runTimers();
    await flush();
    expect(env.fetched).toHaveLength(0);
    expect(env.reloads).toBe(0);
  });
});

// A REPAIR THAT LEAVES THE OLD WORKER INSTALLED IS NOT A REPAIR. That worker
// intercepts the repair's own `cache: 'reload'` requests and can answer them
// out of Cache Storage, so the reload lands on the same blank page — and the
// once-per-tab guard has already been spent. iOS is where this bites: Safari
// keeps a home-screen app's worker and caches indefinitely, and there is no
// per-site cache reset a guard on a shift is going to find.
describe('the repair clears the worker and the caches first', () => {
  it('unregisters every service worker and empties every cache, then reloads', async () => {
    const env = boot([BUNDLE, CSS]);
    env.fireError(BUNDLE);
    await flush();
    await flush();

    expect(env.unregistered).toBe(1);
    expect(env.cachesDeleted).toEqual(['gatepass-shell-v2', 'gatepass-assets-v2']);
    expect(env.fetched.map((f) => f.url)).toEqual([BUNDLE, CSS]);
    expect(env.reloads).toBe(1);
  });

  it('still re-fetches and reloads where there are no service workers at all', async () => {
    const env = boot([BUNDLE], 0, { swSupport: false, cacheSupport: false });
    env.fireError(BUNDLE);
    await flush();
    await flush();

    expect(env.unregistered).toBe(0);
    expect(env.fetched.map((f) => f.url)).toEqual([BUNDLE]);
    expect(env.reloads).toBe(1);
  });
});
