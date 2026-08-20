// DEACTIVATING AN OFFICE HOLDER VACATES THEIR OFFICE (migration 059).
//
// Client, 2026-08-20: "if one of the roles, like COO and security head, is
// deactivated and created again, that should allow me to deactivate one person
// from that role and create another new person in that same role … but make
// sure only one account is tacked to that role at the same point in time."
//
// The database is what enforces the swap — `approval_roles.role_key` is the
// primary key and `set_approval_role` upserts on it, so two holders are not
// representable, and `tests/security/sqlInvariants.test.ts` pins the vacate and
// the active-only refusal. What only the SCREEN can get wrong is these two:
// telling the admin what the press is about to cost before they make it, and
// re-reading the ladder afterwards instead of going on naming somebody the
// database no longer seats.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const PROFILES = [
  // The COO. An office holder's VMS role really is `staff` (046) — the office
  // is a second, independent grant carried beside the role.
  { id: 'u1', full_name: 'Sudeshna Pal', email: 'coo@demo.vms', role: 'staff', created_at: '2026-08-01T00:00:00Z' },
  { id: 'u2', full_name: 'Guard One', email: 'guard1@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z' },
];

const LADDER = [{
  role_key: 'coo',
  user_id: 'u1',
  full_name: 'Sudeshna Pal',
  department_name: null,
  designated_at: '2026-08-01T00:00:00Z',
  deputy_id: null,
  deputy_name: null,
}];

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

import UsersTab from '../../src/pages/Admin/UsersTab';

async function openDeactivateFor(name: string) {
  render(<UsersTab />);
  await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
  const row = screen.getByText(name).closest('tr')!;
  fireEvent.click(within(row).getByRole('button', { name: 'Deactivate' }));
  await screen.findByText('Deactivate User?');
}

describe('deactivating an office holder (059)', () => {
  beforeEach(() => rpcSpy.mockClear());

  it('says which office the press is about to vacate', async () => {
    // The cost is not to this person — it is to everybody else's passes: 046
    // never snapshots a vacant office, so a pass raised before a replacement is
    // designated does not owe that office a signature at all.
    await openDeactivateFor('Sudeshna Pal');
    const note = screen.getByTestId('deactivate-vacates-office');
    expect(note.textContent).toMatch(/COO/);
    expect(note.textContent).toMatch(/vacates/i);
  });

  it('says nothing of the sort about somebody holding no office', async () => {
    await openDeactivateFor('Guard One');
    expect(screen.queryByTestId('deactivate-vacates-office')).toBeNull();
  });

  it('re-reads the ladder after the deactivation, never assuming it is unchanged', async () => {
    await openDeactivateFor('Sudeshna Pal');
    const before = rpcSpy.mock.calls.filter((c) => c[0] === 'get_approval_ladder').length;
    const confirm = screen.getAllByRole('button', { name: 'Deactivate' })
      .find((b) => b.className.includes('btn-danger'))!;
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('admin_soft_delete_user', { p_user_id: 'u1' }),
    );
    await waitFor(() =>
      expect(rpcSpy.mock.calls.filter((c) => c[0] === 'get_approval_ladder').length)
        .toBeGreaterThan(before),
    );
  });
});
