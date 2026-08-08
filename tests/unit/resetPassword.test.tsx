// /reset-password — the page the recovery email links to. It must NOT show a
// "current password" field (the whole point of the link is that the user does
// not know it — the email IS the proof of identity). It shows the new-password
// form only once supabase-js has confirmed the recovery token, and it must
// survive a re-visited (stale) link without pretending anything happened.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ResetPassword from '../../src/pages/ResetPassword';

type AuthCb = (event: string, session?: unknown) => void;

const { authCallbacks, updateUser, signOut } = vi.hoisted(() => ({
  authCallbacks: [] as AuthCb[],
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../src/supabaseClient', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (cb: AuthCb) => {
        authCallbacks.push(cb);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      updateUser,
      signOut,
    },
  },
  gp: () => ({
    from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  }),
  pub: () => ({
    from: () => ({ select: () => Promise.resolve({ data: [], error: null }) }),
  }),
}));

beforeEach(() => {
  authCallbacks.length = 0;
  updateUser.mockReset();
  updateUser.mockResolvedValue({ error: null });
  signOut.mockReset();
  signOut.mockResolvedValue({ error: null });
});

describe('ResetPassword page', () => {
  it('does not show a password form until the recovery token is confirmed', () => {
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>
    );
    expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    expect(screen.getByText(/verifying your link/i)).toBeInTheDocument();
  });

  it('shows the new-password form once PASSWORD_RECOVERY fires', () => {
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>
    );
    act(() => {
      authCallbacks.forEach((cb) => cb('PASSWORD_RECOVERY', { user: { id: 'u1' } }));
    });
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
  });

  it('refuses a short password before calling updateUser', () => {
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>
    );
    act(() => {
      authCallbacks.forEach((cb) => cb('PASSWORD_RECOVERY', { user: { id: 'u1' } }));
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'abc' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

    expect(screen.getByText(/at least 6 characters/i)).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('refuses mismatched passwords before calling update', () => {
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>
    );
    act(() => {
      authCallbacks.forEach((cb) => cb('PASSWORD_RECOVERY', { user: { id: 'u1' } }));
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'secret1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'secret2' } });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('calls updateUser with the new password and signs the recovery session out', async () => {
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>
    );
    act(() => {
      authCallbacks.forEach((cb) => cb('PASSWORD_RECOVERY', { user: { id: 'u1' } }));
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'brand-new-pass' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'brand-new-pass' } });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: 'brand-new-pass' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(await screen.findByText(/password updated/i)).toBeInTheDocument();
  });

  it('surfaces an updateUser failure and keeps the form usable', async () => {
    updateUser.mockResolvedValue({ error: { message: 'Password should be different from old one' } });
    render(
      <MemoryRouter>
        <ResetPassword />
      </MemoryRouter>
    );
    act(() => {
      authCallbacks.forEach((cb) => cb('PASSWORD_RECOVERY', { user: { id: 'u1' } }));
    });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'same-as-before1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'same-as-before1' } });
    fireEvent.click(screen.getByRole('button', { name: /set new password/i }));

    expect(await screen.findByText(/different from/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('explains a stale link instead of showing a dead form', () => {
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter>
          <ResetPassword />
        </MemoryRouter>
      );
      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(screen.getByText(/link is invalid/i)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
      expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});