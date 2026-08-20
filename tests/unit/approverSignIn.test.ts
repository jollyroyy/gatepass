// An approval office holder CAN SIGN IN.
//
// The four offices (Security Head / COO / Finance HOD / CEO) are created by
// migration 046 as VMS `staff` — the role for "does not use VMS" — and their
// row in `gatepass.approval_roles` is what grants them their route and their
// queue. `isAccountActive` therefore says false about them, and
// `fetchAccessState` used to answer with exactly that, so App.tsx showed all
// four of them "Account Deactivated" and none of them could reach anything.
// Nobody was suspended: `gatepass.user_status` held no row for any of them
// (checked live as `postgres`, 2026-08-20).
//
// The fix is that this derivation asks `isDirectoryActive` — the question the
// admin directory already asked — so the office is part of the answer.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const rpc = vi.fn();

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc }),
}));

import { fetchAccessState } from '../../src/lib/profiles';

const OFFICE_HOLDER = {
  id: 'u-coo',
  email: 'coo@demo.quest',
  full_name: 'Questmallcoo',
  role: 'staff',
  department_id: null,
  created_at: '2026-08-20T00:00:00Z',
  is_active: null,
  must_change_password: false,
};

beforeEach(() => {
  rpc.mockReset();
});

describe('fetchAccessState — an office holder is not a deactivated account', () => {
  it('a `staff` account holding an approval office is active', async () => {
    rpc.mockReturnValue(rpcResponse({ data: OFFICE_HOLDER, error: null }));
    expect(await fetchAccessState(true)).toEqual({ mustChangePassword: false, isActive: true });
  });

  // The suspension outranks the office — `is_user_active` is what app_role()
  // reads, so a suspended holder reaches nothing whatever this screen says.
  it('a suspended office holder is still inactive', async () => {
    rpc.mockReturnValue(rpcResponse({ data: { ...OFFICE_HOLDER, is_active: false }, error: null }));
    expect((await fetchAccessState(true)).isActive).toBe(false);
  });

  // A bare `staff` row with no office reaches nothing, exactly as before. It
  // is NOT reported as a suspension though: App.tsx's role check is what
  // catches it, with a message that fits the cause ("No Gate Pass Access").
  it('a bare `staff` row with no office is not called active', async () => {
    rpc.mockReturnValue(rpcResponse({ data: OFFICE_HOLDER, error: null }));
    expect((await fetchAccessState(false)).isActive).toBe(false);
  });

  it('a guard is unaffected — the regression that matters most', async () => {
    rpc.mockReturnValue(rpcResponse({ data: { ...OFFICE_HOLDER, role: 'guard' }, error: null }));
    expect((await fetchAccessState(false)).isActive).toBe(true);
    rpc.mockReturnValue(
      rpcResponse({ data: { ...OFFICE_HOLDER, role: 'guard', is_active: false }, error: null }),
    );
    expect((await fetchAccessState(false)).isActive).toBe(false);
  });

  it('no profile row at all is not a suspension', async () => {
    rpc.mockReturnValue(rpcResponse({ data: null, error: null }));
    expect((await fetchAccessState(false)).isActive).toBe(true);
  });
});
