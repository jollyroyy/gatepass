// Migration 054: every approval office may carry ONE STANDING DEPUTY, named by
// an admin on the same card that designates the holder.
//
// What these cases pin is the shape of the control, not the database's rules —
// "one person, one seat" is enforced by a unique index and two RPC refusals,
// and `tests/security/sqlInvariants.test.ts` is where that lives. Here we hold
// the three things only the screen can get wrong: the deputy seat is offered at
// all, choosing somebody calls the deputy RPC rather than the holder one,
// clearing it calls the CLEAR rpc rather than writing a null, and an office
// with nobody in it cannot be given a deputy.
//
// Mocking pattern copied from tests/unit/createApproverUser.test.tsx — same
// `thenable` shape, same `gp()`/`fetchDirectory` mocks, so this file cannot
// drift from how the rest of the admin portal's tests fake Supabase.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROFILES = [
  { id: 'u1', full_name: 'Sanjay Rao', email: 'sanjay@demo.vms', role: 'staff', created_at: '2026-08-01T00:00:00Z' },
  { id: 'u2', full_name: 'Priya Nair', email: 'priya@demo.vms', role: 'staff', created_at: '2026-08-01T00:00:00Z' },
];

/** Only the Security Head office is filled. The COO's empty seat is what the
 *  last case below is about. */
const LADDER = [
  {
    role_key: 'security_head',
    user_id: 'u1',
    full_name: 'Sanjay Rao',
    department_name: 'Security',
    designated_at: '2026-08-01T00:00:00Z',
    deputy_id: null,
    deputy_name: null,
  },
];

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'insert', 'delete', 'schema', 'from']) obj[m] = () => obj;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj.then = (ok: any, err?: any) => Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

const rpcSpy = vi.hoisted(() =>
  vi.fn((name: string) => {
    if (name === 'get_approval_ladder') return Promise.resolve({ data: LADDER, error: null });
    return Promise.resolve({ data: null, error: null });
  }),
);

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: () => thenable([]), rpc: rpcSpy, schema: () => ({ from: () => thenable([]) }) }),
  pub: () => ({ from: () => thenable([]) }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin1' } } }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDirectory: () => Promise.resolve(PROFILES),
}));

import ApprovalLadderCard from '../../src/pages/Admin/ApprovalLadderCard';

async function renderCard() {
  render(<ApprovalLadderCard />);
  // The deputy control only exists once the ladder has loaded.
  await waitFor(() => expect(screen.getByLabelText('Security Head deputy')).toBeTruthy());
}

describe('the approval ladder card offers a deputy seat (054)', () => {
  beforeEach(() => rpcSpy.mockClear());

  it('offers a deputy select beside every office holder select', async () => {
    await renderCard();
    expect(screen.getByLabelText('Security Head account')).toBeTruthy();
    expect(screen.getByLabelText('Security Head deputy')).toBeTruthy();
    expect(screen.getByLabelText('CEO deputy')).toBeTruthy();
  });

  it('names a deputy through set_approval_deputy, not set_approval_role', async () => {
    // The two seats are different RPCs. Calling the holder's one here would
    // silently REPLACE the office holder with their intended cover — the exact
    // mistake this card exists to make impossible.
    await renderCard();
    fireEvent.change(screen.getByLabelText('Security Head deputy'), { target: { value: 'u2' } });
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('set_approval_deputy', {
        p_role_key: 'security_head',
        p_user_id: 'u2',
      }),
    );
    expect(rpcSpy).not.toHaveBeenCalledWith('set_approval_role', expect.anything());
  });

  it('CLEARS the seat rather than writing a null when the blank option is chosen', async () => {
    // `deputy_id` is nullable but the write is an update, not an upsert of null
    // through the setter — the database has two operations here and the screen
    // must pick the right one.
    await renderCard();
    fireEvent.change(screen.getByLabelText('Security Head deputy'), { target: { value: '' } });
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('clear_approval_deputy', { p_role_key: 'security_head' }),
    );
  });

  it('will not let an EMPTY office take a deputy', async () => {
    // `approval_roles.user_id` is NOT NULL, so there is no row to hang a deputy
    // on until somebody holds the office. The RPC refuses it in a sentence;
    // offering a control whose only possible outcome is that sentence is worse
    // than not offering it.
    await renderCard();
    expect((screen.getByLabelText('CEO deputy') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Security Head deputy') as HTMLSelectElement).disabled).toBe(false);
  });

  it('no longer claims that designating somebody grants no access', async () => {
    // 046 made that sentence false — an office holder gets /approvals and both
    // decision RPCs — and it sat on this card unrevised until 054.
    await renderCard();
    expect(document.body.textContent).not.toMatch(/grants no access of any kind/i);
    expect(document.body.textContent).toMatch(/grants them real authority/i);
  });
});
