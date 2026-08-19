// Registers public/sw.js — the one thing that makes the installed app open
// without a browser behind it.
//
// PRODUCTION ONLY, and that is not a cautious default. A service worker in
// front of the dev server serves modules Vite has already replaced, so HMR
// appears to work and the page keeps rendering the previous edit — the worst
// failure mode available, because it looks like the code is wrong.
//
// `updateViaCache: 'none'` makes the browser revalidate sw.js itself on every
// registration rather than serving it from the HTTP cache. Without it a
// deployment can be up to 24 hours late to a phone that already has the app.
//
// Failure is deliberately silent. A worker that will not register (private
// browsing, an unsupported WebView, an http:// origin) costs the user nothing —
// the app is a plain web app without it — so there is nothing here worth
// interrupting somebody's shift with.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!('serviceWorker' in navigator)) return;

  // After load, not during: registration competes with the first render for
  // the same connection otherwise, and the first render is what the user is
  // waiting for.
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => undefined);
  });
}
