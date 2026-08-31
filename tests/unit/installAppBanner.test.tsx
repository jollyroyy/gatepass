// The visible half of the install story.
//
// Three audiences, and they need three different things:
//   Chrome/Edge  → a button that calls the event we captured
//   iOS Safari   → words, because there is no event and no menu item
//   already installed → nothing, on any platform
//
// The banner is also the one piece of UI that must not nag: it is dismissible
// and the dismissal is remembered, because it appears on every screen.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import InstallAppBanner from '../../src/components/InstallAppBanner';
import {
  captureInstallPrompt,
  __resetInstallPromptForTests,
  INSTALL_DISMISSED_KEY,
} from '../../src/lib/installPrompt';

function fireBeforeInstallPrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event: any = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  window.dispatchEvent(event);
  return event;
}

function setUserAgent(ua: string, touchPoints = 5) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  __resetInstallPromptForTests();
  captureInstallPrompt();
  setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36', 5);
  (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
});

describe('InstallAppBanner', () => {
  it('shows nothing before the browser says the app is installable', () => {
    const { container } = render(<InstallAppBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('appears when the event arrives after mount', async () => {
    render(<InstallAppBanner />);
    act(() => { fireBeforeInstallPrompt(); });
    expect(await screen.findByRole('button', { name: /install/i })).toBeInTheDocument();
  });

  it('appears when the event arrived BEFORE mount — the usual case', async () => {
    fireBeforeInstallPrompt();
    render(<InstallAppBanner />);
    expect(await screen.findByRole('button', { name: /install/i })).toBeInTheDocument();
  });

  it('opens the browser dialog and disappears once accepted', async () => {
    const event = fireBeforeInstallPrompt('accepted');
    render(<InstallAppBanner />);
    const button = await screen.findByRole('button', { name: /install/i });
    await act(async () => { fireEvent.click(button); });
    expect(event.prompt).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument());
  });

  it('goes away for good when dismissed', async () => {
    fireBeforeInstallPrompt();
    render(<InstallAppBanner />);
    const later = await screen.findByRole('button', { name: /not now/i });
    await act(async () => { fireEvent.click(later); });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^install/i })).not.toBeInTheDocument());
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBeTruthy();
  });

  it('stays away on the next screen after a dismissal', () => {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, 'x');
    fireBeforeInstallPrompt();
    const { container } = render(<InstallAppBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tells an iPhone how, because Safari fires no event and offers no menu item', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    render(<InstallAppBanner />);
    expect(screen.getByText(/share/i)).toBeInTheDocument();
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
    // There is no event to prompt with, so there must be no button pretending
    // otherwise — a button that does nothing is worse than the instruction.
    expect(screen.queryByRole('button', { name: /^install/i })).not.toBeInTheDocument();
  });

  it('shows nothing at all inside the installed app', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15');
    (navigator as any).standalone = true;
    const { container } = render(<InstallAppBanner />);
    expect(container).toBeEmptyDOMElement();
    delete (navigator as any).standalone;
  });

  it('does not print', async () => {
    fireBeforeInstallPrompt();
    const { container } = render(<InstallAppBanner />);
    await screen.findByRole('button', { name: /install/i });
    expect(container.firstElementChild?.className).toContain('no-print');
  });
});

describe('InstallAppBanner — the browsers that fire no event', () => {
  it('gives Firefox for Android its own menu item, and no dead button', () => {
    setUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:121.0) Gecko/121.0 Firefox/121.0');
    render(<InstallAppBanner />);
    expect(screen.getByText(/⋮ menu/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^install app/i })).not.toBeInTheDocument();
  });

  it('tells an in-app webview to open a real browser instead of pretending', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS]');
    render(<InstallAppBanner />);
    expect(screen.getByText(/Chrome or Safari/)).toBeInTheDocument();
  });

  it('stays silent on a Chromium that has not offered the event', () => {
    setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
    const { container } = render(<InstallAppBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});
