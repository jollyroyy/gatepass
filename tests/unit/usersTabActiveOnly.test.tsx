// The client, 2026-08-19: "on the admin page when you are showing all users, it
// should only show the active users and move all the inactive users to the
// inactive tab. I don't see any reactivate option when we are seeing the
// inactive users. Besides there I'm only seeing that edit."
//
// Two reversals of settled behaviour, both asked for by name:
//
//   1. EVERY tab except Inactive is now ACTIVE-ONLY. Before this, `all` meant
//      literally everyone and the Guard/HOD tabs deliberately listed suspended
//      people too ("they are still a guard"). That argument is sound and the
//      client overruled it: a directory that mixes people who can sign in with
//      people who cannot is one an admin has to read the Status column of, row
//      by row. The status is the tab now.
//
//   2. AN INACTIVE ROW ALWAYS OFFERS REACTIVATE. A `staff` row used to offer
//      Edit alone, because `admin_reactivate_user` refuses a target with no
//      role to restore. That is still true of the RPC — so Reactivate on such
//      a row opens a role choice and sets the role first, rather than being a
//      button that always raises. A suspended guard/HOD keeps the one-click
//      Reactivate it already had.
//
// Watched failing first: the All tab listed Benched Guard, and Legacy Staff had
// no Reactivate button at all.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const PROFILES = [
  { id: 'u1', full_name: 'Active Guard', email: 'g1@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z', is_active: true },
  { id: 'u2', full_name: 'Benched Guard', email: 'g2@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z', is_active: false },
  { id: 'u3', full_name: 'Suspended Hod', email: 'h1@demo.vms', role: 'hod', created_at: '2026-08-01T00:00:00Z', is_active: false },
  { id: 'u4', full_name: 'Legacy Staff', email: 's1@demo.vms', role: 'staff', created_at: '2026-08-01T00:00:00Z', is_active: true },
  { id: 'u5', full_name: 'The Admin', email: 'a1@demo.vms', role: 'admin', created_at: '2026-08-01T00:00:00Z', is_active: true },
  { id: 'u6', full_name: 'Active Hod', email: 'h2@demo.vms', role: 'hod', created_at: '2026-08-01T00:00:00Z', is_active: true },
];

const DEPTS = [{ id: 'd1', name: 'Housekeeping', code: 'HK' }];

function thenable(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'eq', 'order', 'limit', 'in', 'insert', 'delete', 'schema', 'from']) obj[m] = () => obj;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  obj.then = (ok: any, err?: any) => Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

const rpcSpy = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: null, error: null })));

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => thenable([]),
    rpc: rpcSpy,
    schema: () => ({ from: () => thenable(DEPTS) }),
  }),
  pub: () => ({ from: () => thenable([]) }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin1' } } }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDirectory: () => Promise.resolve(PROFILES),
}));

import UsersTab from '../../src/pages/Admin/UsersTab';

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

/** The open popup, so a control inside it is never confused with the row
 *  button of the same name that opened it. */
function dialog(): HTMLElement {
  return screen.getByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function renderTab() {
  render(<UsersTab />);
  await waitFor(() => expect(screen.getByText('Active Guard')).toBeInTheDocument());
}

describe('UsersTab — every tab but Inactive is active-only', () => {
  it('the All tab lists nobody who is inactive', async () => {
    await renderTab();
    expect(screen.getByText('Active Guard')).toBeInTheDocument();
    expect(screen.getByText('Active Hod')).toBeInTheDocument();
    expect(screen.getByText('The Admin')).toBeInTheDocument();
    expect(screen.queryByText('Benched Guard')).not.toBeInTheDocument();
    expect(screen.queryByText('Suspended Hod')).not.toBeInTheDocument();
    // A `staff` row reaches nothing in this app, so it is inactive too.
    expect(screen.queryByText('Legacy Staff')).not.toBeInTheDocument();
  });

  it('the Guard tab drops a suspended guard — the client overruled the old rule', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Guard' }));
    expect(screen.getByText('Active Guard')).toBeInTheDocument();
    expect(screen.queryByText('Benched Guard')).not.toBeInTheDocument();
  });

  it('the HOD tab drops a suspended HOD', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'HOD' }));
    expect(screen.getByText('Active Hod')).toBeInTheDocument();
    expect(screen.queryByText('Suspended Hod')).not.toBeInTheDocument();
  });

  it('the Inactive tab holds every one of them, and nobody active', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    expect(screen.getByText('Benched Guard')).toBeInTheDocument();
    expect(screen.getByText('Suspended Hod')).toBeInTheDocument();
    expect(screen.getByText('Legacy Staff')).toBeInTheDocument();
    expect(screen.queryByText('Active Guard')).not.toBeInTheDocument();
    expect(screen.queryByText('The Admin')).not.toBeInTheDocument();
  });
});

describe('UsersTab — an inactive row always offers Reactivate', () => {
  it('a suspended guard reactivates in one click, with no role choice', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    fireEvent.click(within(rowFor('Benched Guard')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('admin_reactivate_user', { p_user_id: 'u2' }),
    );
    // The role was never touched — 040 kept it, so there is nothing to restore.
    expect(rpcSpy.mock.calls.some((c) => c[0] === 'admin_update_user')).toBe(false);
  });

  it('a legacy staff row offers Reactivate too, and it asks which role', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    fireEvent.click(within(rowFor('Legacy Staff')).getByRole('button', { name: 'Reactivate' }));
    // Nothing has been written yet — the choice is the whole point.
    expect(rpcSpy.mock.calls.some((c) => c[0] === 'admin_reactivate_user')).toBe(false);
    expect(screen.getByRole('heading', { name: 'Reactivate User?' })).toBeInTheDocument();
    const select = within(dialog()).getByLabelText('Role') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['guard', 'hod']);
  });

  it('confirming that choice sets the role FIRST, then flips the flag', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    fireEvent.click(within(rowFor('Legacy Staff')).getByRole('button', { name: 'Reactivate' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('admin_reactivate_user', { p_user_id: 'u4' }),
    );
    const order = rpcSpy.mock.calls.map((c) => c[0]);
    // `admin_reactivate_user` raises on a target whose role is not guard/hod,
    // so the update is not merely first for tidiness — it is what makes the
    // second call legal.
    expect(order.indexOf('admin_update_user')).toBeLessThan(order.indexOf('admin_reactivate_user'));
    const [, args] = rpcSpy.mock.calls.find((c) => c[0] === 'admin_update_user')!;
    expect(args).toMatchObject({ p_user_id: 'u4', p_role: 'guard' });
  });

  it('choosing HOD carries the department through the same two calls', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    fireEvent.click(within(rowFor('Legacy Staff')).getByRole('button', { name: 'Reactivate' }));
    fireEvent.change(within(dialog()).getByLabelText('Role'), { target: { value: 'hod' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: /Housekeeping/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('admin_reactivate_user', { p_user_id: 'u4' }),
    );
    const [, args] = rpcSpy.mock.calls.find((c) => c[0] === 'admin_update_user')!;
    expect(args).toMatchObject({ p_role: 'hod', p_department_ids: ['d1'] });
  });

  it('an active row still offers Deactivate and never Reactivate', async () => {
    await renderTab();
    const row = rowFor('Active Guard');
    expect(within(row).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
  });
});
