// The install affordance, at the level of the module that owns the event.
//
// WHY THIS EXISTS AT ALL: nothing in this app ever offered to install itself.
// The manifest, the icons and the worker were all correct — `pwaAssets.test.ts`
// has pinned them since they landed — and on a phone that produced no button,
// because Chrome removed the automatic mini-infobar years ago. An installable
// site that never calls `prompt()` is installable only through a browser menu
// nobody opens, and on iOS not even that: Safari never fires the event, so the
// Share sheet has to be described in words or it is not discoverable.
//
// `beforeinstallprompt` FIRES ONCE AND CANNOT BE REPLAYED. It commonly arrives
// before React has mounted anything, so the capture has to live outside the
// component tree and hand the stored event over on subscribe — a component that
// merely adds its own listener on mount sees nothing and shows no button.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  captureInstallPrompt,
  getInstallPrompt,
  subscribeInstallPrompt,
  promptInstall,
  isStandalone,
  isIosDevice,
  installDismissed,
  dismissInstall,
  INSTALL_DISMISSED_KEY,
  __resetInstallPromptForTests,
} from '../../src/lib/installPrompt';

type Choice = { outcome: 'accepted' | 'dismissed'; platform: string };

function fireBeforeInstallPrompt(choice: Choice = { outcome: 'accepted', platform: 'web' }) {
  const event: any = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve(choice);
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetInstallPromptForTests();
  captureInstallPrompt();
});

describe('captureInstallPrompt', () => {
  it('stores the event and stops the browser showing its own bar', () => {
    const event = fireBeforeInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallPrompt()).toBe(event);
  });

  it('tells a subscriber that arrived after the event, not only before it', () => {
    fireBeforeInstallPrompt();
    const late = vi.fn();
    subscribeInstallPrompt(late);
    // Subscribing is itself the notification when the event is already in hand;
    // a late component would otherwise wait for a second event that never comes.
    expect(getInstallPrompt()).not.toBeNull();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('notifies subscribers when the event arrives', () => {
    const seen = vi.fn();
    subscribeInstallPrompt(seen);
    seen.mockClear();
    fireBeforeInstallPrompt();
    expect(seen).toHaveBeenCalled();
  });

  it('unsubscribing stops the notifications', () => {
    const seen = vi.fn();
    const off = subscribeInstallPrompt(seen);
    off();
    seen.mockClear();
    fireBeforeInstallPrompt();
    expect(seen).not.toHaveBeenCalled();
  });

  it('drops the stored event once the app is installed', () => {
    fireBeforeInstallPrompt();
    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstallPrompt()).toBeNull();
  });

  it('is idempotent — a second call does not double-handle the event', () => {
    const seen = vi.fn();
    subscribeInstallPrompt(seen);
    captureInstallPrompt();
    seen.mockClear();
    fireBeforeInstallPrompt();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe('promptInstall', () => {
  it('shows the browser dialog and reports what the user chose', async () => {
    const event = fireBeforeInstallPrompt({ outcome: 'accepted', platform: 'web' });
    await expect(promptInstall()).resolves.toBe('accepted');
    expect(event.prompt).toHaveBeenCalled();
  });

  it('spends the event — it cannot be prompted twice', async () => {
    fireBeforeInstallPrompt();
    await promptInstall();
    expect(getInstallPrompt()).toBeNull();
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('keeps nothing when there is no event', async () => {
    await expect(promptInstall()).resolves.toBe('unavailable');
  });

  it('survives a browser that rejects the call', async () => {
    const event = fireBeforeInstallPrompt();
    event.prompt = vi.fn(async () => { throw new Error('not allowed'); });
    await expect(promptInstall()).resolves.toBe('unavailable');
  });
});

describe('isStandalone', () => {
  it('is true when the app was launched from the home screen', () => {
    const original = window.matchMedia;
    (window as any).matchMedia = (q: string) => ({ matches: q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} });
    expect(isStandalone()).toBe(true);
    (window as any).matchMedia = original;
  });

  it('is true for iOS, which answers on navigator instead of matchMedia', () => {
    const original = window.matchMedia;
    (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    (navigator as any).standalone = true;
    expect(isStandalone()).toBe(true);
    delete (navigator as any).standalone;
    (window as any).matchMedia = original;
  });
});

describe('isIosDevice', () => {
  it('recognises an iPhone', () => {
    expect(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe(true);
  });

  it('recognises an iPad reporting itself as a Mac — every iPad since iPadOS 13 does', () => {
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 5)).toBe(true);
  });

  it('does not mistake a desktop Mac for one', () => {
    expect(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 0)).toBe(false);
  });

  it('does not mistake Android for one', () => {
    expect(isIosDevice('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36')).toBe(false);
  });
});

describe('dismissal', () => {
  it('remembers a dismissal so the banner does not come back every screen', () => {
    expect(installDismissed()).toBe(false);
    dismissInstall();
    expect(installDismissed()).toBe(true);
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBeTruthy();
  });

  it('never throws where storage is denied', () => {
    const original = window.localStorage.setItem;
    window.localStorage.setItem = () => { throw new Error('denied'); };
    expect(() => dismissInstall()).not.toThrow();
    window.localStorage.setItem = original;
  });
});
