// The install route on the SIGN-IN screen, which is the screen a phone lands on.
//
// THE FIRST VERSION PUT THE BANNER BEHIND THE LOGIN and that was the whole bug
// the client hit: they opened the Vercel URL on an Android phone, sat on
// /login, and there was nothing to see because the only install affordance in
// the app rendered inside AppShell.
//
// It is a DISCLOSURE, not a banner, and it is always present. Two reasons it
// cannot be conditioned on `beforeinstallprompt` the way the in-app banner is:
// this screen is where somebody comes LOOKING for the answer, and Chrome can
// refuse to fire that event for an origin it has installed once before — the
// client's exact case, after uninstalling — leaving the ⋮ menu as the only way
// in. The instruction is always available; the button appears when it can.
import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import InstallHint from '../../src/components/InstallHint';
import { captureInstallPrompt, __resetInstallPromptForTests } from '../../src/lib/installPrompt';

function setUserAgent(ua: string, touchPoints = 5) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}

function fireBeforeInstallPrompt() {
  const event: any = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = vi.fn(async () => undefined);
  event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
  window.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetInstallPromptForTests();
  captureInstallPrompt();
  setUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36');
  (window as any).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
});

describe('InstallHint', () => {
  it('is offered even when no browser event ever arrives', () => {
    render(<InstallHint />);
    expect(screen.getByRole('button', { name: /install this app/i })).toBeInTheDocument();
  });

  it('names the Chrome menu when asked — the only route left after an uninstall', () => {
    render(<InstallHint />);
    fireEvent.click(screen.getByRole('button', { name: /install this app/i }));
    expect(screen.getByText(/⋮ menu in Chrome/)).toBeInTheDocument();
  });

  it('gives an iPhone the Safari toolbar instead', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1');
    render(<InstallHint />);
    fireEvent.click(screen.getByRole('button', { name: /install this app/i }));
    expect(screen.getByText(/Safari toolbar/)).toBeInTheDocument();
  });

  it('installs directly when the browser did offer the event', async () => {
    const event = fireBeforeInstallPrompt();
    render(<InstallHint />);
    const button = screen.getByRole('button', { name: /install app/i });
    await act(async () => { fireEvent.click(button); });
    expect(event.prompt).toHaveBeenCalled();
  });

  it('shows nothing inside the installed app', () => {
    (navigator as any).standalone = true;
    const { container } = render(<InstallHint />);
    expect(container).toBeEmptyDOMElement();
    delete (navigator as any).standalone;
  });

  it('does not print', () => {
    const { container } = render(<InstallHint />);
    expect(container.firstElementChild?.className).toContain('no-print');
  });
});
