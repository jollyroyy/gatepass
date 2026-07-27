// src/lib/profiles.ts exists because a policy on VMS's public.profiles table
// once recursed into itself (SQLSTATE 42P17) and took down every GatePass
// screen that displayed a person's name. All person data now flows through
// gatepass-schema RPCs instead. These specs pin that contract so a future
// edit can't quietly reintroduce a public.profiles read or swallow a failed
// lookup as if it were "no profile".
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirrors the real supabase-js shape this module depends on: rpc() itself
// resolves to {data, error} (fetchDirectory awaits it directly), and also
// carries a .maybeSingle() method resolving to the same shape (fetchMyProfile
// uses that path). A real PostgrestFilterBuilder is thenable, not a Promise
// instance — the fake must be thenable too, not a plain Promise, or a bug
// that calls .maybeSingle() on a bare Promise would go undetected.
type RpcResult = { data: unknown; error: { message: string } | null };

function rpcResponse(result: RpcResult) {
  return {
    then(onFulfilled: (v: RpcResult) => unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected);
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
}

// A transport-level failure (network down, RPC not found) — distinct from an
// RPC that resolved with {error}. fetchDisplayName must swallow this too.
function rpcRejection(err: unknown) {
  return {
    then(_onFulfilled: unknown, onRejected?: (e: unknown) => unknown) {
      return Promise.reject(err).then(undefined, onRejected);
    },
    maybeSingle() {
      return Promise.reject(err);
    },
  };
}

const rpc = vi.fn();

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc }),
}));

import { fetchMyProfile, fetchDirectory, fetchDisplayName, nameFromEmail } from '../../src/lib/profiles';

// role arrives as plain text from Postgres, not a typed UserRole — the row
// shape a real RPC response has, before toProfile() casts it.
const ROW = {
  id: 'u1',
  email: 'sudeshna.pal@x.com',
  full_name: 'Sudeshna Pal',
  role: 'hod',
  department_id: 'd1',
  created_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  rpc.mockReset();
});

describe('fetchMyProfile', () => {
  it('calls the RPC that replaced the recursive public.profiles read, and maps role through', async () => {
    rpc.mockReturnValue(rpcResponse({ data: ROW, error: null }));
    const profile = await fetchMyProfile();
    expect(rpc).toHaveBeenCalledWith('my_profile');
    expect(profile).toEqual({ ...ROW, role: 'hod' });
  });

  it('returns null when the caller has no profile row, instead of throwing', async () => {
    rpc.mockReturnValue(rpcResponse({ data: null, error: null }));
    expect(await fetchMyProfile()).toBeNull();
  });

  it('throws on a failed lookup — a broken role check must not silently look like "no profile"', async () => {
    rpc.mockReturnValue(rpcResponse({ data: null, error: { message: 'boom' } }));
    await expect(fetchMyProfile()).rejects.toEqual({ message: 'boom' });
  });
});

describe('fetchDirectory', () => {
  it('passes p_role: null when no role filter is given (the "everyone" case)', async () => {
    rpc.mockReturnValue(rpcResponse({ data: [], error: null }));
    await fetchDirectory();
    expect(rpc).toHaveBeenCalledWith('admin_list_profiles', { p_role: null });
  });

  it('passes the requested role through as p_role (Departments tab wants only HODs)', async () => {
    rpc.mockReturnValue(rpcResponse({ data: [], error: null }));
    await fetchDirectory('hod');
    expect(rpc).toHaveBeenCalledWith('admin_list_profiles', { p_role: 'hod' });
  });

  it('maps every row to a Profile', async () => {
    rpc.mockReturnValue(rpcResponse({ data: [ROW], error: null }));
    expect(await fetchDirectory()).toEqual([{ ...ROW, role: 'hod' }]);
  });

  it('defaults to [] when data is null, rather than crashing the admin screen', async () => {
    rpc.mockReturnValue(rpcResponse({ data: null, error: null }));
    expect(await fetchDirectory()).toEqual([]);
  });

  it('throws when the admin-gated RPC refuses an unprivileged caller', async () => {
    rpc.mockReturnValue(
      rpcResponse({ data: null, error: { message: 'Only an admin can list users.' } })
    );
    await expect(fetchDirectory()).rejects.toEqual({ message: 'Only an admin can list users.' });
  });
});

describe('fetchDisplayName', () => {
  it('returns the profile full_name when present', async () => {
    rpc.mockReturnValue(rpcResponse({ data: ROW, error: null }));
    expect(await fetchDisplayName('sudeshna.pal@x.com')).toBe('Sudeshna Pal');
  });

  // A guard must still reach the gate console even if the name lookup is
  // broken — none of the four failure modes below may throw or hang.

  it('falls back to the email-derived name when the RPC call rejects outright', async () => {
    rpc.mockReturnValue(rpcRejection(new Error('network down')));
    expect(await fetchDisplayName('guard@x.com')).toBe('Guard');
  });

  it('falls back to the email-derived name when the RPC resolves with an error', async () => {
    rpc.mockReturnValue(rpcResponse({ data: null, error: { message: 'db error' } }));
    expect(await fetchDisplayName('guard@x.com')).toBe('Guard');
  });

  it('falls back to the email-derived name when the profile row is null', async () => {
    rpc.mockReturnValue(rpcResponse({ data: null, error: null }));
    expect(await fetchDisplayName('guard@x.com')).toBe('Guard');
  });

  it('falls back to the email-derived name when full_name is empty or whitespace', async () => {
    rpc.mockReturnValue(rpcResponse({ data: { ...ROW, full_name: '   ' }, error: null }));
    expect(await fetchDisplayName('guard@x.com')).toBe('Guard');
  });
});

describe('nameFromEmail', () => {
  it.each([
    ['sudeshna.pal@x.com', 'Sudeshna'],
    ['guard@x.com', 'Guard'],
    ['', 'User'],
    [null, 'User'],
    [undefined, 'User'],
  ] as const)('%s -> %s', (input, expected) => {
    expect(nameFromEmail(input)).toBe(expected);
  });
});
