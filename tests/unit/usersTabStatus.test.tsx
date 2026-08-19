// The admin portal's user table used to have one column doing two jobs: Role,
// which read "Inactive" for anyone suspended, because suspending someone wrote
// `profiles.role = 'staff'`. Migration 040 splits them — Role holds a role,
// Status holds Active/Inactive from gatepass.user_status.
//
// Watched failing against the pre-040 UsersTab first.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const PROFILES = [
  { id: 'u1', full_name: 'Active Guard', email: 'g1@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z', is_active: true },
  { id: 'u2', full_name: 'Benched Guard', email: 'g2@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z', is_active: false },
  { id: 'u3', full_name: 'Suspended Hod', email: 'h1@demo.vms', role: 'hod', created_at: '2026-08-01T00:00:00Z', is_active: false },
  { id: 'u4', full_name: 'Legacy Staff', email: 's1@demo.vms', role: 'staff', created_at: '2026-08-01T00:00:00Z', is_active: true },
  { id: 'u5', full_name: 'The Admin', email: 'a1@demo.vms', role: 'admin', created_at: '2026-08-01T00:00:00Z', is_active: true },
];

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
  gp: () => ({ from: () => thenable([]), rpc: rpcSpy, schema: () => ({ from: () => thenable([]) }) }),
  pub: () => ({ from: () => thenable([]) }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin1' } } }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDirectory: () => Promise.resolve(PROFILES),
}));

import UsersTab from '../../src/pages/Admin/UsersTab';

/** The <tr> a person's name sits in. */
function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function renderTab() {
  render(<UsersTab />);
  await waitFor(() => expect(screen.getByText('Active Guard')).toBeInTheDocument());
}

/** Every tab but Inactive is active-only since 2026-08-19, so a suspended or
 *  roleless person is reached through that tab and nowhere else. */
async function renderInactiveTab() {
  await renderTab();
  fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
}

describe('UsersTab — Role and Status are separate columns', () => {
  it('the table has both headers', async () => {
    await renderTab();
    expect(screen.getByRole('columnheader', { name: 'Role' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
  });

  it('a suspended guard still reads Guard in the Role column', async () => {
    await renderInactiveTab();
    const row = rowFor('Benched Guard');
    expect(within(row).getByText('Guard')).toBeInTheDocument();
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
  });

  it('a suspended HOD keeps their role too — 040 stopped erasing it', async () => {
    await renderInactiveTab();
    const row = rowFor('Suspended Hod');
    expect(within(row).getByText('HOD')).toBeInTheDocument();
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
  });

  it('an active account reads Active', async () => {
    await renderTab();
    const row = rowFor('Active Guard');
    expect(within(row).getByText('Active')).toBeInTheDocument();
    expect(within(row).queryByText('Inactive')).not.toBeInTheDocument();
  });

  // A legacy `staff` row is honest about both facts: VMS's role, and the fact
  // that such an account can reach nothing here.
  it('a legacy staff row reads Staff / Inactive', async () => {
    await renderInactiveTab();
    const row = rowFor('Legacy Staff');
    expect(within(row).getByText('Staff')).toBeInTheDocument();
    expect(within(row).getByText('Inactive')).toBeInTheDocument();
  });
});

describe('UsersTab — staff is not an assignable role', () => {
  // Migration 046: the Add User control also offers the four gate pass
  // approval offices (Security Head/COO/CEO/Finance HOD), which are created
  // as VMS `staff` under the hood — see tests/unit/createApproverUser.test.tsx
  // for that behaviour. This case only pins that plain `staff` itself is
  // still not a selectable option.
  it('the Add User role select never offers bare "staff"', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    const select = screen.getByLabelText('Role') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).not.toContain('staff');
  });

  it('the Edit User role select offers Guard and HOD only — no "Deactivate (Staff)"', async () => {
    await renderTab();
    fireEvent.click(within(rowFor('Active Guard')).getByRole('button', { name: 'Edit' }));
    const select = screen.getByLabelText('Role') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['guard', 'hod']);
    expect(select.textContent).not.toMatch(/staff/i);
  });

  // Editing a suspended person must not silently reinstate them: the status
  // column is the only thing that reactivates, so an admin fixing a typo in a
  // name cannot hand back access by accident.
  it('saving the Edit modal never sends a role of staff', async () => {
    await renderInactiveTab();
    fireEvent.click(within(rowFor('Benched Guard')).getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('admin_update_user', expect.anything()));
    const [, args] = rpcSpy.mock.calls.find((c) => c[0] === 'admin_update_user')!;
    expect((args as { p_role: string }).p_role).not.toBe('staff');
  });
});

describe('UsersTab — reactivation flips the status, it does not invent a role', () => {
  it('a suspended guard offers Reactivate, and it calls the RPC directly', async () => {
    await renderInactiveTab();
    fireEvent.click(within(rowFor('Benched Guard')).getByRole('button', { name: 'Reactivate' }));
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('admin_reactivate_user', { p_user_id: 'u2' })
    );
  });

  // SUPERSEDED 2026-08-19: this used to hold that a legacy `staff` row offers
  // Edit and no Reactivate, because flipping the flag on a roleless account
  // would report someone Active who still cannot sign in — which the server
  // refuses too. The client asked for the button on every inactive row, so it
  // is there now and opens the role choice the RPC is demanding. The refusal
  // is unchanged; what changed is that the portal answers it instead of
  // hiding the control. See tests/unit/usersTabActiveOnly.test.tsx.
  it('a legacy staff row now offers Reactivate as well as Edit', async () => {
    await renderInactiveTab();
    const row = rowFor('Legacy Staff');
    expect(within(row).getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });

  it('an active account offers Deactivate, not Reactivate', async () => {
    await renderTab();
    const row = rowFor('Active Guard');
    expect(within(row).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
  });

  it('an admin row offers neither — the RPCs refuse an admin target', async () => {
    await renderTab();
    const row = rowFor('The Admin');
    expect(within(row).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Reactivate' })).not.toBeInTheDocument();
  });
});

describe('UsersTab — the Inactive filter is a status filter now', () => {
  it('shows every suspended account regardless of role', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Inactive' }));
    expect(screen.getByText('Benched Guard')).toBeInTheDocument();
    expect(screen.getByText('Suspended Hod')).toBeInTheDocument();
    expect(screen.getByText('Legacy Staff')).toBeInTheDocument();
    expect(screen.queryByText('Active Guard')).not.toBeInTheDocument();
  });

  // SUPERSEDED 2026-08-19: the Guard filter used to list a suspended guard too
  // ("they are still a guard"). The client asked for every tab but Inactive to
  // be active-only, so the role tabs are now a filter over people who can
  // actually sign in. Pinned in tests/unit/usersTabActiveOnly.test.tsx.
  it('the Guard filter shows active guards only', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Guard' }));
    expect(screen.getByText('Active Guard')).toBeInTheDocument();
    expect(screen.queryByText('Benched Guard')).not.toBeInTheDocument();
    expect(screen.queryByText('Suspended Hod')).not.toBeInTheDocument();
  });
});
