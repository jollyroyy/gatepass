// The App-level gate for an admin-reset password (migration 036). A signed-in
// user whose gatepass.my_profile().must_change_password is true must see the
// ForcePasswordChange screen and NOT the app shell, on ANY URL — and this must
// not regress the common case, which is every existing session where the flag
// is false.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type AuthCb = (event: string, session: unknown) => void;

// App.tsx reads both app-wide gates (the 036 password flag and 040's active
// flag) from ONE my_profile() call — see fetchAccessState in lib/profiles.
const { authCallbacks, getSession, getUserRole, fetchAccessState } = vi.hoisted(() => ({
  authCallbacks: [] as AuthCb[],
  getSession: vi.fn(),
  getUserRole: vi.fn(),
  fetchAccessState: vi.fn(),
}));

const mustChange = (flag: boolean) => ({ mustChangePassword: flag, isActive: true });

const FAKE_SESSION = { user: { id: 'u1', email: 'guard@demo.vms', app_metadata: { role: 'guard' } } };

vi.mock('../../src/supabaseClient', () => ({
  getUserRole,
  supabase: {
    auth: {
      getSession,
      onAuthStateChange: (cb: AuthCb) => {
        authCallbacks.push(cb);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      signOut: () => Promise.resolve({ error: null }),
    },
    channel: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ch: any = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: () => undefined,
  },
  gp: () => ({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t: any = {};
      for (const m of ['select', 'eq', 'gte', 'order', 'limit', 'in']) t[m] = () => t;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      t.then = (ok: any, err?: any) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok, err);
      return t;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: () => ({ then: (ok: any, err?: any) => Promise.resolve({ data: [], error: null }).then(ok, err) }),
  }),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pub: () => ({ from: () => ({ then: (ok: any, err?: any) => Promise.resolve({ data: [], error: null }).then(ok, err) }) }),
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchMyProfile: () => Promise.resolve({ full_name: 'Guard One', avatar_url: null }),
  fetchDisplayName: () => Promise.resolve('Guard One'),
  fetchMustChangePassword: () => Promise.resolve(false),
  fetchAccessState,
}));

import App from '../../src/App';

beforeEach(() => {
  authCallbacks.length = 0;
  getSession.mockResolvedValue({ data: { session: FAKE_SESSION } });
  getUserRole.mockResolvedValue('guard');
  fetchAccessState.mockReset();
});

describe('App — admin-reset password gate', () => {
  it('shows ForcePasswordChange, not the app shell, when the flag is true', async () => {
    fetchAccessState.mockResolvedValue(mustChange(true));

    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /set your password/i })).toBeInTheDocument()
    );
    expect(screen.queryByRole('heading', { name: 'Search Pass' })).not.toBeInTheDocument();
  });

  it('is not escapable by URL — a deep link still lands on the gate', async () => {
    fetchAccessState.mockResolvedValue(mustChange(true));

    render(
      <MemoryRouter initialEntries={['/admin-dashboard']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /set your password/i })).toBeInTheDocument()
    );
  });

  it('reaches the app normally when the flag is false — the regression that matters most', async () => {
    fetchAccessState.mockResolvedValue(mustChange(false));

    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Search Pass' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: /set your password/i })).not.toBeInTheDocument();
  });

  it('fails open (reaches the app) when the my_profile lookup errors', async () => {
    fetchAccessState.mockRejectedValue(new Error('network down'));

    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Search Pass' })).toBeInTheDocument());
  });
});
