// Idle session timeout, ported from VMS's SessionTimeout but at 5 minutes
// rather than VMS's 10 — a gate terminal is a shared, physically exposed
// machine, so an abandoned session is a bigger exposure than at a desk.
//
// The prompt deliberately does NOT reset on activity once it is showing: if it
// did, the mouse nudge that wakes a screen would silently cancel a logout the
// guard never saw. It resets only on an explicit "Keep session".
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

// vi.mock is hoisted above every top-level const, so the spy has to be created
// inside vi.hoisted or the factory closes over a TDZ binding.
const { signOut } = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve({ error: null })) }));

vi.mock('../../src/supabaseClient', () => ({
  supabase: { auth: { signOut } },
  gp: () => ({}),
  pub: () => ({}),
}));

import SessionTimeout, { IDLE_TIMEOUT_MS, COUNTDOWN_SEC } from '../../src/components/SessionTimeout';

beforeEach(() => {
  vi.useFakeTimers();
  signOut.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('SessionTimeout', () => {
  it('is configured for five minutes', () => {
    expect(IDLE_TIMEOUT_MS).toBe(5 * 60 * 1000);
  });

  it('renders nothing while the session is active', () => {
    render(<SessionTimeout />);
    advance(IDLE_TIMEOUT_MS - 1000);
    expect(screen.queryByText('Session Timeout')).not.toBeInTheDocument();
  });

  it('prompts after five idle minutes', () => {
    render(<SessionTimeout />);
    advance(IDLE_TIMEOUT_MS);
    expect(screen.getByText('Session Timeout')).toBeInTheDocument();
  });

  it('restarts the idle clock on user activity', () => {
    render(<SessionTimeout />);
    advance(IDLE_TIMEOUT_MS - 5000);
    act(() => {
      document.dispatchEvent(new Event('keydown'));
    });
    advance(10000);
    expect(screen.queryByText('Session Timeout')).not.toBeInTheDocument();

    advance(IDLE_TIMEOUT_MS);
    expect(screen.getByText('Session Timeout')).toBeInTheDocument();
  });

  it('signs out when the countdown runs out', () => {
    render(<SessionTimeout />);
    advance(IDLE_TIMEOUT_MS);
    expect(signOut).not.toHaveBeenCalled();

    advance(COUNTDOWN_SEC * 1000);
    expect(signOut).toHaveBeenCalled();
  });

  it('does not let background activity silently cancel a visible prompt', () => {
    render(<SessionTimeout />);
    advance(IDLE_TIMEOUT_MS);
    expect(screen.getByText('Session Timeout')).toBeInTheDocument();

    act(() => {
      document.dispatchEvent(new Event('mousedown'));
    });
    expect(screen.getByText('Session Timeout')).toBeInTheDocument();
  });

  it('dismisses and restarts the clock on "Keep session"', () => {
    render(<SessionTimeout />);
    advance(IDLE_TIMEOUT_MS);
    fireEvent.click(screen.getByRole('button', { name: /keep session/i }));

    expect(screen.queryByText('Session Timeout')).not.toBeInTheDocument();
    advance(COUNTDOWN_SEC * 1000);
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out immediately on "Sign out"', () => {
    render(<SessionTimeout />);
    advance(IDLE_TIMEOUT_MS);
    fireEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });
});
