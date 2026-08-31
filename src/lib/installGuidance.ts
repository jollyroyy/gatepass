import { isIosDevice } from './installPrompt';

// WHICH BROWSER IS THIS, AND HOW DOES *IT* INSTALL A WEB APP?
//
// `beforeinstallprompt` is a Chromium extension, not a web standard, and the
// first cut of the install banner was written as though the mobile world were
// Chromium or Safari. It is not. Five different answers ship on phones:
//
//   Chrome / Edge / Opera / Samsung on Android  the event → a real button
//   Safari on iOS                               Share → Add to Home Screen
//   Chrome / Firefox / Edge on iOS              WebKit underneath, so the same
//                                               sheet reached through their own
//                                               menu, NOT "the bar at the
//                                               bottom of Safari"
//   Firefox on Android                          installs from its ⋮ menu and
//                                               fires no event, ever
//   Facebook / Instagram / WhatsApp / WebView   cannot install at all
//
// A WRONG SENTENCE IS WORSE THAN NO SENTENCE. Telling a guard to tap a Share
// icon that is not on their screen, or drawing a button with no event behind
// it, spends their shift hunting for a control that does not exist. Everything
// here is therefore biased towards `none`: this module says something only when
// it can name the exact gesture that works in the browser in front of it.
//
// UA sniffing is the only instrument available — there is no capability to feature
// -detect for "this browser can add to the home screen". So a live event always
// outranks the sniff, and no guess is made about a Chromium that has stayed
// quiet: Chrome withholds the event both when it is about to fire and when the
// app is ALREADY installed, and those are indistinguishable from here.

export type InstallGuidanceKind =
  /** The browser handed us `beforeinstallprompt`. Draw the button. */
  | 'prompt'
  /** iOS Safari: the Share control in the toolbar. */
  | 'ios-safari'
  /** Chrome/Firefox/Edge/Opera on iOS: their own Share item, same sheet. */
  | 'ios-browser'
  /** Firefox for Android: ⋮ → Install. */
  | 'firefox-android'
  /** An embedded webview. Nothing can install here; leaving it is the fix. */
  | 'open-in-browser'
  /** Say nothing. */
  | 'none';

export type InstallGuidance = {
  kind: InstallGuidanceKind;
  /** Is there a home screen to add to? Only the copy depends on this. */
  mobile: boolean;
};

/** The shells that render a page inside another app. `; wv)` is Android's own
 *  WebView marker; the rest name themselves. Chrome Custom Tabs are NOT here —
 *  they carry no `wv` and install perfectly well. */
const IN_APP = /;\s*wv\)|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|Line\/|WhatsApp|Snapchat|Pinterest|LinkedInApp|TwitterAndroid|GSA\//i;

/** iOS browsers that are Safari underneath and say so in their own dialect. */
const IOS_THIRD_PARTY = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo/i;

function looksMobile(ua: string, touchPoints: number): boolean {
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return true;
  return isIosDevice(ua, touchPoints);
}

export function installGuidance(opts: {
  canPrompt: boolean;
  ua?: string;
  touchPoints?: number;
}): InstallGuidance {
  const ua = opts.ua ?? (typeof navigator === 'undefined' ? '' : navigator.userAgent);
  const touchPoints = opts.touchPoints ?? (typeof navigator === 'undefined' ? 0 : (navigator.maxTouchPoints ?? 0));
  const mobile = looksMobile(ua, touchPoints);

  // An event in hand is evidence; everything below it is inference.
  if (opts.canPrompt) return { kind: 'prompt', mobile };

  // BEFORE the iOS test on purpose: Facebook's iOS shell reports an iPhone, and
  // an iOS-first order would print a Share instruction that does nothing there.
  if (IN_APP.test(ua)) return { kind: 'open-in-browser', mobile };

  if (isIosDevice(ua, touchPoints)) {
    return { kind: IOS_THIRD_PARTY.test(ua) ? 'ios-browser' : 'ios-safari', mobile };
  }

  if (/Android/i.test(ua) && /Firefox\//i.test(ua)) return { kind: 'firefox-android', mobile };

  return { kind: 'none', mobile };
}

/**
 * The gesture that installs this app in the browser at hand, in words.
 *
 * SEPARATE FROM `installGuidance` BECAUSE IT ANSWERS A DIFFERENT QUESTION.
 * That function decides whether to VOLUNTEER something, and stays silent on a
 * Chromium that has not fired the event, because silence beats telling somebody
 * to install what they already have. This one is only ever called because a
 * person ASKED how — on the sign-in screen, behind a disclosure they opened —
 * and at that point "already installed" is not a risk worth being unhelpful
 * over. So it always has an answer, including the Chrome menu route.
 *
 * THE MENU ROUTE IS ALSO THE ONLY ANSWER AFTER AN UNINSTALL. Chrome remembers
 * an origin it has installed before and can decline to fire
 * `beforeinstallprompt` again on that device long after the app is gone; the
 * ⋮ menu keeps working the whole time.
 */
export function manualInstallHint(ua?: string, touchPoints?: number): string {
  const { kind } = installGuidance({ canPrompt: false, ua, touchPoints });
  switch (kind) {
    case 'ios-safari':
      return 'Tap Share (the square with an arrow up) in the Safari toolbar, then Add to Home Screen.';
    case 'ios-browser':
      return 'Open the browser menu, tap Share, then Add to Home Screen.';
    case 'firefox-android':
      return 'Open the ⋮ menu, then tap Install.';
    case 'open-in-browser':
      return 'Open this page in Chrome or Safari first — an in-app browser cannot install it.';
    default:
      return 'Open the ⋮ menu in Chrome, then tap Install app (or Add to Home screen).';
  }
}
