// A supabase auth event must NOT tear down the signed-in tree.
//
// App used to call setResolving(true) inside onAuthStateChange. `resolving`
// makes App return <FullPageLoader/>, which unmounts AppShell and everything
// under it — including SessionTimeout, whose idle clock then restarts from zero
// on remount. supabase-js fires TOKEN_REFRESHED/SIGNED_IN on token refresh and
// on tab visibility recovery, so simply switching away from the tab and back
// reset the idle timer and the 5-minute timeout could never elapse.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

type AuthCb = (event: string, session: unknown) => void;

const { authCallbacks, getSession, getUserRole } = vi.hoisted(() => ({
  authCallbacks: [] as AuthCb[],
  getSession: vi.fn(),
  getUserRole: vi.fn(),
}));

const FAKE_SESSION = { user: { id: 'u1', email: 'guard@demo.vms', app_metadata: { role: 'guard' } } };

vi.mock('../../src/supabaseClient', () => ({
  getUserRole,
  supabase: {
    auth: {
      getSession: getSession,
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
}));

import App from '../../src/App';

beforeEach(() => {
  authCallbacks.length = 0;
  getSession.mockResolvedValue({ data: { session: FAKE_SESSION } });
  getUserRole.mockResolvedValue('guard');
});

describe('App auth resolution', () => {
  it('keeps the signed-in tree mounted across a token refresh', async () => {
    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Search Pass' })).toBeInTheDocument());
    expect(authCallbacks.length).toBeGreaterThan(0);

    // Hold the role lookup open. The regression is a TRANSIENT unmount while
    // re-resolution is in flight — if the promise is allowed to settle first,
    // the tree is back by the time any assertion runs and the bug is invisible.
    let release: (v: string) => void = () => undefined;
    getUserRole.mockImplementation(() => new Promise<string>((r) => { release = r; }));

    // Exactly what supabase-js does on token refresh and on tab re-focus.
    act(() => {
      authCallbacks.forEach((cb) => cb('TOKEN_REFRESHED', FAKE_SESSION));
    });

    // If this regresses, the tree flips to the full-page loader and every
    // mounted timer — SessionTimeout's included — restarts from zero.
    expect(screen.getByRole('heading', { name: 'Search Pass' })).toBeInTheDocument();

    await act(async () => {
      release('guard');
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Search Pass' })).toBeInTheDocument();
  });

  it('still tears down to the login route when the session actually ends', async () => {
    render(
      <MemoryRouter initialEntries={['/console']}>
        <App />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Search Pass' })).toBeInTheDocument());

    getUserRole.mockResolvedValue(null);
    await act(async () => {
      authCallbacks.forEach((cb) => cb('SIGNED_OUT', null));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Search Pass' })).not.toBeInTheDocument());
  });
});
