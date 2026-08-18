// The App-level gate for a deactivated account (migration 040).
//
// Deactivation used to demote the person to `staff`, and the existing
// role-has-no-place check below caught that. Now the role SURVIVES the
// suspension, so their JWT still says `guard` and that check waves them
// through — every read they make is refused by RLS instead, leaving someone
// staring at an app that silently shows nothing. This gate is what turns that
// into a sentence they can act on.
//
// RLS remains the real boundary: is_user_active() is consulted by app_role()
// and my_department_ids(), so this screen is UX, not security.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type AuthCb = (event: string, session: unknown) => void;

const { authCallbacks, getSession, getUserRole, fetchAccessState } = vi.hoisted(() => ({
  authCallbacks: [] as AuthCb[],
  getSession: vi.fn(),
  getUserRole: vi.fn(),
  fetchAccessState: vi.fn(),
}));

const FAKE_SESSION = { user: { id: 'u1', email: 'guard@demo.vms', app_metadata: { role: 'guard' } } };

vi.mock('../../src/supabaseClient', () => ({
  getUserRole,
  supabase: {
    auth: {
      getSession,
      getUser: () => Promise.resolve({ data: { user: FAKE_SESSION.user } }),
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

describe('App — deactivated account gate', () => {
  it('a suspended guard sees the no-access screen, not the console', async () => {
    fetchAccessState.mockResolvedValue({ mustChangePassword: false, isActive: false });

    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Account Deactivated' })).toBeInTheDocument()
    );
    expect(screen.queryByRole('heading', { name: 'Search Pass' })).not.toBeInTheDocument();
  });

  it('is not escapable by URL', async () => {
    fetchAccessState.mockResolvedValue({ mustChangePassword: false, isActive: false });

    render(
      <MemoryRouter initialEntries={['/admin-dashboard']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Account Deactivated' })).toBeInTheDocument()
    );
  });

  it('an active account reaches the app — the regression that matters most', async () => {
    fetchAccessState.mockResolvedValue({ mustChangePassword: false, isActive: true });

    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Search Pass' })).toBeInTheDocument());
  });

  // 040 writes a user_status row only for someone actually suspended, and a
  // failed lookup must not lock out every existing session over a dropped
  // packet. RLS still refuses a genuinely suspended person's reads.
  it('fails open when the my_profile lookup errors', async () => {
    fetchAccessState.mockRejectedValue(new Error('network down'));

    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Search Pass' })).toBeInTheDocument());
  });

  it('the forced password change still outranks it', async () => {
    fetchAccessState.mockResolvedValue({ mustChangePassword: true, isActive: true });

    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /set your password/i })).toBeInTheDocument()
    );
  });
});
