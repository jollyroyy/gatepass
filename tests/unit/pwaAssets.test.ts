// @vitest-environment node
//
// The installable-app contract: the files a phone reads BEFORE any React runs.
//
// Every assertion here is about something that fails SILENTLY in a browser. A
// manifest with a missing icon still parses and simply never offers to install;
// an apple-touch-icon pointing at a file that is not there puts a screenshot of
// the login page on the home screen instead; a service worker that registers
// but handles no fetch event leaves the installed app showing the browser's
// offline dinosaur. None of that shows up in a build, in a typecheck, or on a
// laptop — which is why it is pinned here rather than left to be noticed.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = (...parts: string[]) => resolve(__dirname, '../..', ...parts);
const manifest = JSON.parse(readFileSync(root('public/manifest.webmanifest'), 'utf8'));
const html = readFileSync(root('index.html'), 'utf8');
const sw = readFileSync(root('public/sw.js'), 'utf8');
const favicon = readFileSync(root('public/favicon.svg'), 'utf8');

describe('PWA: the web app manifest', () => {
  it('declares the fields an install prompt needs', () => {
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.scope).toBe('/');
    // Anything less than standalone keeps the browser's address bar, which is
    // the one visible difference between an app and a bookmark.
    expect(manifest.display).toBe('standalone');
    expect(manifest.background_color).toBeTruthy();
    expect(manifest.theme_color).toBeTruthy();
  });

  it('ships a 192, a 512 and a maskable icon, and every file is on disk', () => {
    const icons: Array<{ src: string; sizes: string; purpose?: string }> = manifest.icons;
    expect(icons.some((i) => i.sizes === '192x192')).toBe(true);
    expect(icons.some((i) => i.sizes === '512x512')).toBe(true);
    // Without a maskable icon Android drops the square PNG into its launcher
    // shape and draws a white border around whatever is left.
    expect(icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of icons) {
      expect(existsSync(root('public', icon.src.replace(/^\//, '')))).toBe(true);
    }
  });

  it('carries no shortcuts, because this app has no route every role can open', () => {
    // /raise is a HOD's, /guard-dashboard is security's, /approvals belongs to
    // whoever holds an office. A static shortcut list would put three roles out
    // of four one long-press away from a screen they are refused. If shortcuts
    // are ever added they have to be role-aware, which a manifest cannot be.
    expect(manifest.shortcuts).toBeUndefined();
  });
});

describe('PWA: index.html', () => {
  it('links the manifest', () => {
    expect(html).toMatch(/<link rel="manifest" href="\/manifest\.webmanifest"/);
  });

  it('carries an apple-touch-icon that exists — Safari never reads the manifest for it', () => {
    const match = html.match(/<link rel="apple-touch-icon" href="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(existsSync(root('public', match![1].replace(/^\//, '')))).toBe(true);
  });

  it('declares a theme colour and the standalone meta both platforms read', () => {
    expect(html).toMatch(/<meta name="theme-color" content="#[0-9A-Fa-f]{6}"/);
    expect(html).toMatch(/<meta name="mobile-web-app-capable" content="yes"/);
    expect(html).toMatch(/<meta name="apple-mobile-web-app-capable" content="yes"/);
  });

  it('does NOT claim viewport-fit=cover while nothing pays the inset back', () => {
    // Cover without env(safe-area-inset-*) padding renders the topbar under the
    // status bar on a notched phone. The two ship together or neither ships.
    //
    // Read the TAG, not the file: the comment above it in index.html says the
    // words "viewport-fit=cover" while explaining their absence, and a whole-file
    // regex fails on the explanation.
    const viewport = html.match(/<meta name="viewport" content="([^"]+)"/);
    expect(viewport).not.toBeNull();
    expect(viewport![1]).not.toContain('viewport-fit');
  });
});

describe('PWA: the service worker', () => {
  it('is registered from the app entry, in production only', () => {
    const register = readFileSync(root('src/lib/registerServiceWorker.ts'), 'utf8');
    // A worker in front of the dev server serves modules Vite has replaced, so
    // an edit appears to apply and does not. This guard is why dev still works.
    expect(register).toMatch(/import\.meta\.env\.PROD/);
    expect(register).toMatch(/navigator\.serviceWorker\.register\('\/sw\.js'/);
    expect(readFileSync(root('src/main.tsx'), 'utf8')).toMatch(/registerServiceWorker\(\)/);
  });

  it('answers navigations network-first, so a deploy is never invisible', () => {
    expect(sw).toMatch(/addEventListener\('fetch'/);
    expect(sw).toMatch(/request\.mode === 'navigate'.*networkFirst/s);
  });

  it('never caches another origin — a stale approval queue is worse than none', () => {
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/);
  });
});

describe('the brand mark', () => {
  it('gives every stroked path an explicit fill', () => {
    // An SVG path with no `fill` fills BLACK. favicon.svg's outline path is the
    // whole diamond, so until 2026-08-19 it painted over all four gold faces and
    // the mark rendered as a black diamond with a gold edge — invisible at 16px
    // in a tab, unmissable at 192px on a home screen. scripts/make-pwa-icons.mjs
    // draws the same geometry, so the two have to agree.
    const stroked = favicon.match(/<path\b[^>]*\bstroke=/gs) ?? [];
    expect(stroked.length).toBeGreaterThan(0);
    for (const path of stroked) expect(path).toMatch(/fill="/);
  });
});
