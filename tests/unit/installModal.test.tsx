// The popup that asks, instead of waiting to be noticed.
//
// The banner is polite to the point of invisibility: it sits above the page
// content, one card among several, and on a phone it is below the fold as often
// as not. The client's ask on 2026-08-31 was plainer than that — when the app
// is not on the device, SAY SO, in front of the screen.
//
// It is still an offer, not a trap: one dismissal closes it, the dismissal is
// remembered, and it never appears inside the installed app. On iOS, where
// there is no event to fire, it carries the Share-sheet words instead of a
// button that could not do anything.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import InstallModal from '../../src/components/InstallModal';
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

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36';

beforeEach(() => {
  window.localStorage.clear();
  __resetInstallPromptForTests();
  captureInstallPrompt();
  setUserAgent(ANDROID, 5);
  (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
});

describe('InstallModal', () => {
  it('asks on a phone that can install, without being clicked first', async () => {
    fireBeforeInstallPrompt();
    render(<InstallModal />);
    expect(await screen.findByRole('dialog', { name: /install/i })).toBeInTheDocument();
  });

  it('asks when the event turns up after mount', async () => {
    render(<InstallModal />);
    act(() => { fireBeforeInstallPrompt(); });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('opens the browser dialog and closes itself', async () => {
    const event = fireBeforeInstallPrompt('accepted');
    render(<InstallModal />);
    const button = await screen.findByRole('button', { name: /install app/i });
    await act(async () => { fireEvent.click(button); });
    expect(event.prompt).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('closes and stays closed when refused', async () => {
    fireBeforeInstallPrompt();
    render(<InstallModal />);
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: /not now/i })); });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBeTruthy();
  });

  it('does not come back on the next screen after a dismissal', () => {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, new Date().toISOString());
    fireBeforeInstallPrompt();
    const { container } = render(<InstallModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('tells an iPhone the gesture, with no button behind an event it never gets', () => {
    setUserAgent(IPHONE);
    render(<InstallModal />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /install app/i })).not.toBeInTheDocument();
  });

  it('says nothing inside the installed app', () => {
    (window as any).matchMedia = (q: string) => ({ matches: q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} });
    fireBeforeInstallPrompt();
    const { container } = render(<InstallModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('leaves a desktop alone — the banner is enough there', () => {
    setUserAgent(DESKTOP, 0);
    fireBeforeInstallPrompt();
    const { container } = render(<InstallModal />);
    expect(container).toBeEmptyDOMElement();
  });

  it('stays silent where nothing can install', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS]');
    render(<InstallModal />);
    // An in-app webview cannot install at all; a modal it cannot act on is a
    // wall, so this one only names the way out.
    expect(screen.getByText(/Chrome or Safari/)).toBeInTheDocument();
  });
});
