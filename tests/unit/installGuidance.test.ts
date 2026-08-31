// WHICH SENTENCE A GIVEN MOBILE BROWSER NEEDS.
//
// `beforeinstallprompt` is a Chromium extension, not a standard, and the first
// version of this banner assumed the world was Chromium or Safari. It is not:
//
//   Chrome / Edge / Opera / Samsung on Android → the event, so a real button
//   Safari on iOS                              → Share → Add to Home Screen
//   Chrome / Firefox / Edge on iOS             → WebKit underneath, so the same
//                                                sheet, reached a different way
//   Firefox on Android                         → installs from its ⋮ menu and
//                                                fires no event at all
//   Facebook / Instagram / WhatsApp webviews   → CANNOT install, whatever the
//                                                page says; the only way out is
//                                                to open it in a real browser
//
// Getting this wrong is worse than silence: a button with nothing behind it, or
// "tap Share at the bottom of Safari" shown to somebody who is not in Safari,
// sends a guard hunting for a control that is not on their screen.
import { describe, it, expect } from 'vitest';
import { installGuidance, manualInstallHint } from '../../src/lib/installGuidance';

const UA = {
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
  operaAndroid: 'Mozilla/5.0 (Linux; Android 14; CPH2451) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 OPR/79.0.0.0',
  edgeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.0.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15',
  edgeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/120.0.0.0 Mobile/15E148 Safari/605.1.15',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBDV/iPhone15,2]',
  instagramAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.0 Android',
  desktopChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  desktopMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

const guide = (ua: string, canPrompt = false, touchPoints = 5) =>
  installGuidance({ canPrompt, ua, touchPoints });

describe('the browser holds the event', () => {
  it('is a button on Chrome for Android', () => {
    expect(guide(UA.chromeAndroid, true).kind).toBe('prompt');
  });

  it('is a button on every Chromium cousin that fires it', () => {
    for (const ua of [UA.samsung, UA.operaAndroid, UA.edgeAndroid, UA.desktopChrome]) {
      expect(guide(ua, true).kind).toBe('prompt');
    }
  });

  it('outranks every other reading — the event is proof the browser can install', () => {
    // A UA sniff is a guess; a live event is not. If one ever arrives inside
    // something this file would otherwise call a webview, believe the event.
    expect(guide(UA.androidWebView, true).kind).toBe('prompt');
  });
});

describe('WebKit — no event exists to wait for', () => {
  it('names Safari itself on an iPhone', () => {
    expect(guide(UA.safariIos).kind).toBe('ios-safari');
  });

  it('recognises an iPad that reports the desktop Mac UA', () => {
    expect(guide(UA.ipadOs, false, 5).kind).toBe('ios-safari');
  });

  it('does not mistake a real Mac for an iPad', () => {
    expect(guide(UA.desktopMac, false, 0).kind).toBe('none');
  });

  it('sends Chrome, Firefox and Edge on iOS to their own Share menu, not Safaris', () => {
    for (const ua of [UA.chromeIos, UA.firefoxIos, UA.edgeIos]) {
      expect(guide(ua).kind).toBe('ios-browser');
    }
  });
});

describe('Firefox for Android', () => {
  it('gets menu wording — it installs, but never fires the event', () => {
    expect(guide(UA.firefoxAndroid).kind).toBe('firefox-android');
  });
});

describe('in-app browsers', () => {
  it('tells an Android WebView to open a real browser instead', () => {
    expect(guide(UA.androidWebView).kind).toBe('open-in-browser');
  });

  it('recognises the Facebook and Instagram shells', () => {
    expect(guide(UA.facebookIos).kind).toBe('open-in-browser');
    expect(guide(UA.instagramAndroid).kind).toBe('open-in-browser');
  });

  it('beats the iOS reading — the Share sheet inside Facebook cannot install', () => {
    // Facebook's iOS UA says iPhone, so an ios-first test order would print an
    // instruction that does not work in that shell.
    expect(guide(UA.facebookIos).kind).not.toBe('ios-safari');
  });
});

describe('everything else stays silent', () => {
  it('says nothing on Chromium that has not offered the event', () => {
    // It may still be coming, or the app may ALREADY be installed — Chrome
    // withholds the event in both cases. Inventing menu directions here would
    // tell somebody to install what they have.
    expect(guide(UA.chromeAndroid).kind).toBe('none');
    expect(guide(UA.samsung).kind).toBe('none');
  });

  it('says nothing when the user agent is unreadable', () => {
    expect(guide('').kind).toBe('none');
  });
});

describe('mobile flag', () => {
  it('is what lets the copy say "home screen" only where there is one', () => {
    expect(guide(UA.chromeAndroid, true).mobile).toBe(true);
    expect(guide(UA.safariIos).mobile).toBe(true);
    expect(guide(UA.desktopChrome, true).mobile).toBe(false);
  });
});

describe('manualInstallHint — the answer when somebody ASKS how', () => {
  it('names the Safari toolbar on an iPhone', () => {
    expect(manualInstallHint(UA.safariIos, 5)).toMatch(/Safari toolbar/);
  });

  it('does not name Safari to a browser that is not Safari', () => {
    expect(manualInstallHint(UA.chromeIos, 5)).not.toMatch(/Safari/);
    expect(manualInstallHint(UA.chromeIos, 5)).toMatch(/Add to Home Screen/);
  });

  it('names the Firefox menu item', () => {
    expect(manualInstallHint(UA.firefoxAndroid, 5)).toMatch(/Install/);
  });

  it('tells an in-app browser to leave', () => {
    expect(manualInstallHint(UA.facebookIos, 5)).toMatch(/Chrome or Safari/);
  });

  // The case that sent the client looking: Chrome had installed this origin
  // before, and after the uninstall it stopped firing the event on that device.
  // `installGuidance` is silent there ON PURPOSE, so this is the only route
  // left, and it has to exist.
  it('always has an answer for Chrome, event or no event', () => {
    expect(manualInstallHint(UA.chromeAndroid, 5)).toMatch(/menu/i);
    expect(manualInstallHint('', 0)).toMatch(/menu/i);
  });
});
