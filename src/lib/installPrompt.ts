// "Install app" — the button this app never had.
//
// EVERY FILE A PWA NEEDS WAS ALREADY CORRECT. The manifest names the app, the
// icons are on disk at 192, 512 and maskable, public/sw.js registers and handles
// fetch, and the whole thing is served over HTTPS. What was missing is the only
// part a site has to write itself: Chrome stopped showing an automatic install
// bar in 2019, so an installable page that never calls `prompt()` is
// installable only through a browser menu (⋮ → Add to Home screen) that almost
// nobody on a gate shift will find. On iOS there is no menu item and no event at
// all — Safari installs only from the Share sheet, and only if somebody says so.
//
// THE EVENT ARRIVES ONCE, EARLY, AND CANNOT BE ASKED FOR AGAIN. Chrome fires
// `beforeinstallprompt` as soon as it has decided the page qualifies, which is
// routinely before React has mounted a component that could listen for it. So
// the listener is attached from main.tsx at module scope and the event is HELD
// here; a component subscribes and is handed whatever already arrived.
//
// Nothing here decides WHETHER to show anything — that is
// components/InstallAppBanner.tsx, which also has to answer the iOS half.

/** Chrome's non-standard event. Typed by hand: it is in no lib.dom.d.ts. */
export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

/** What `promptInstall()` can honestly report. `unavailable` covers both "no
 *  event was ever offered" and "the browser refused the call" — from the
 *  caller's side those are the same fact: no dialog was shown. */
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export const INSTALL_DISMISSED_KEY = 'gatepass:install-dismissed';

/** Set once we have evidence the app IS on this device. Kept so that the next
 *  `beforeinstallprompt` can be read for what it is — Chromium fires it only
 *  for an origin with no installed app, so seeing one after this marker means
 *  somebody uninstalled us. */
export const INSTALL_INSTALLED_KEY = 'gatepass:install-installed';

/** How long "Not now" lasts. A dismissal used to be permanent, which on a
 *  shared handset meant one tap silenced the offer for good — and survived an
 *  uninstall, so a phone with no icon was never asked again. A week is long
 *  enough not to nag and short enough that a device that lost the app gets
 *  offered it back. */
export const INSTALL_REOFFER_DAYS = 7;

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

/** The attached handlers, kept only so the test seam can detach them again —
 *  the window outlives a test file, and a reset that cannot unbind would leave
 *  one listener per test all handling the same event. */
let attached: { before: (e: Event) => void; installed: () => void } | null = null;

function announce(): void {
  listeners.forEach((fn) => { try { fn(); } catch { /* a listener must not break the rest */ } });
}

/**
 * Attaches the two window listeners. Called from main.tsx before render, and
 * idempotent because a second registration would hand every subscriber the same
 * event twice and prevent-default it twice.
 */
export function captureInstallPrompt(): void {
  if (attached) return;
  if (typeof window === 'undefined') return;

  // Running from the home screen is the only proof iOS ever gives that the app
  // was installed — Safari fires no `appinstalled` — and it is recorded on
  // every standalone launch so the uninstall test below has something to
  // compare against.
  if (isStandalone()) rememberInstalled();

  const before = (event: Event) => {
    // Without this Chrome may show its own UI on some surfaces, and the event
    // is not retained for us to use later.
    event.preventDefault();
    // THE EVENT IS ALSO AN UNINSTALL SIGNAL. A browser that has this app
    // installed does not offer to install it, so an event arriving after we
    // have seen it installed says the icon is gone from the phone. Whatever
    // "Not now" was said while it was still there no longer applies.
    if (wasInstalled()) {
      forgetInstalled();
      clearInstallDismissal();
    }
    deferred = event as InstallPromptEvent;
    announce();
  };
  // Installed from our button or from the browser's own menu — either way there
  // is nothing left to offer, and the banner must go immediately.
  const installed = () => {
    rememberInstalled();
    // Nothing is being refused any more, and leaving the record would outlive
    // the install and suppress the offer after a later uninstall.
    clearInstallDismissal();
    deferred = null;
    announce();
  };

  window.addEventListener('beforeinstallprompt', before);
  window.addEventListener('appinstalled', installed);
  attached = { before, installed };
}

export function getInstallPrompt(): InstallPromptEvent | null {
  return deferred;
}

/**
 * Subscribe to "the installability answer changed".
 *
 * It calls back ONCE IMMEDIATELY when an event is already in hand. A component
 * mounting after Chrome fired the event — the normal case, not the edge one —
 * would otherwise sit waiting for a second event that is never coming.
 */
export function subscribeInstallPrompt(onChange: () => void): () => void {
  listeners.add(onChange);
  if (deferred) onChange();
  return () => { listeners.delete(onChange); };
}

/**
 * Shows the browser's install dialog.
 *
 * THE EVENT IS SPENT WHETHER OR NOT THE USER ACCEPTS — a second `prompt()` on
 * the same event throws — so it is cleared here in every branch. If they said
 * no, Chrome will offer another event on a later visit when it judges the
 * moment better; there is nothing this app can do to bring that forward.
 */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    announce();
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    announce();
    return 'unavailable';
  }
}

/** Already launched from the home screen. Android and desktop answer the media
 *  query; iOS answers only `navigator.standalone`, and answers nothing at all
 *  in a tab, so both have to be asked. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: fullscreen)').matches) return true;
  } catch { /* jsdom and old WebViews */ }
  return (navigator as unknown as { standalone?: boolean }).standalone === true;
}

/**
 * An iPhone or an iPad, whatever browser is wrapped around it — on iOS every
 * browser is Safari's engine and none of them fires `beforeinstallprompt`.
 *
 * The second test is not paranoia: since iPadOS 13 an iPad reports the DESKTOP
 * Mac user agent, and the only thing separating it from a real Mac in the
 * string is that the Mac has no touch points.
 */
export function isIosDevice(
  ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  touchPoints: number = typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0),
): boolean {
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  return /macintosh/i.test(ua) && touchPoints > 1;
}

/**
 * Has this person recently said no?
 *
 * TIME-BOXED, NOT PERMANENT. The stored value is the moment of the refusal;
 * once it is older than `INSTALL_REOFFER_DAYS` the offer comes back on its own.
 * That window is the ONLY re-offer mechanism on iOS, which reports neither an
 * install nor an uninstall. A value that cannot be parsed is honoured rather
 * than ignored — a dismissal wrongly kept is quiet, one wrongly dropped nags.
 */
export function installDismissed(): boolean {
  let raw: string | null = null;
  try { raw = window.localStorage.getItem(INSTALL_DISMISSED_KEY); } catch { return false; }
  if (raw === null) return false;
  const at = Date.parse(raw);
  if (Number.isNaN(at)) return true;
  return Date.now() - at < INSTALL_REOFFER_DAYS * 24 * 60 * 60 * 1000;
}

export function clearInstallDismissal(): void {
  try { window.localStorage.removeItem(INSTALL_DISMISSED_KEY); } catch { /* denied */ }
}

function rememberInstalled(): void {
  try { window.localStorage.setItem(INSTALL_INSTALLED_KEY, new Date().toISOString()); } catch { /* denied */ }
}

function wasInstalled(): boolean {
  try { return window.localStorage.getItem(INSTALL_INSTALLED_KEY) !== null; } catch { return false; }
}

function forgetInstalled(): void {
  try { window.localStorage.removeItem(INSTALL_INSTALLED_KEY); } catch { /* denied */ }
}

/** Remembered rather than held in state: the banner would otherwise return on
 *  every navigation, which is how a helpful offer becomes an advertisement. */
export function dismissInstall(): void {
  try { window.localStorage.setItem(INSTALL_DISMISSED_KEY, new Date().toISOString()); } catch { /* denied */ }
}

/** Test seam only — module state outlives a `beforeEach` otherwise. */
export function __resetInstallPromptForTests(): void {
  if (attached && typeof window !== 'undefined') {
    window.removeEventListener('beforeinstallprompt', attached.before);
    window.removeEventListener('appinstalled', attached.installed);
  }
  attached = null;
  deferred = null;
  listeners.clear();
}
