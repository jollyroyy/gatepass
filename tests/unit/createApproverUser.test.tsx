// Migration 046: an admin creates a Security Head / COO / CEO / Finance HOD
// account exactly like a guard or HOD one — the Add-User role control now
// offers the four gate pass approval offices alongside Guard and HOD, and
// `admin_create_user` accepts the office key directly as `p_role`.
//
// The Edit-User modal is UNCHANGED: `admin_update_user` was not extended,
// and moving an office is still only `set_approval_role` / `clear_approval_role`
// behind the "Gate pass approval ladder" card — so that dropdown keeps
// offering Guard and HOD only.
//
// Mocking pattern copied from tests/unit/usersTabModals.test.tsx /
// usersTabStatus.test.tsx — the same `thenable` shape and the same
// `gp()`/`fetchDirectory` mocks, so this file cannot silently drift from how
// the rest of the admin portal's tests fake Supabase.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

const PROFILES = [
  { id: 'u1', full_name: 'Guard One', email: 'guard1@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z' },
  { id: 'u2', full_name: 'Priya CEO', email: 'priya@demo.vms', role: 'staff', created_at: '2026-08-01T00:00:00Z' },
];

const APPROVAL_ROLES = [
  {
    role_key: 'ceo',
    user_id: 'u2',
    full_name: 'Priya CEO',
    department_name: null,
    designated_at: '2026-08-01T00:00:00Z',
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
    if (name === 'get_approval_ladder') {
      return Promise.resolve({ data: APPROVAL_ROLES, error: null });
    }
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

/** The <tr> a person's name sits in. */
function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcSpy.mockImplementation((name: string) => {
    if (name === 'get_approval_ladder') {
      return Promise.resolve({ data: APPROVAL_ROLES, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
});

async function renderTab() {
  render(<UsersTab />);
  await waitFor(() => expect(screen.getByText('Guard One')).toBeInTheDocument());
}

describe('Add User — the four approval offices are offered', () => {
  it('the role select offers Guard, HOD and all four offices', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    const select = screen.getByLabelText('Role') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual([
      'guard',
      'hod',
      'security_head',
      'coo',
      'ceo',
      'finance_head',
    ]);
  });

  it('groups the offices under their own optgroup, distinct from the VMS roles', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    const select = screen.getByLabelText('Role') as HTMLSelectElement;
    const groups = [...select.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups).toContain('Gate pass approval office');
  });

  it('picking an office hides the Department control and warns the office will move', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    const dialog = screen.getByRole('dialog');
    const select = within(dialog).getByLabelText('Role') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'ceo' } });

    expect(within(dialog).queryByText('Department')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/move the office to the new person/i)).toBeInTheDocument();
    expect(within(dialog).getByText('Priya CEO')).toBeInTheDocument();
  });

  it('picking a vacant office warns with no current-holder sentence', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    const select = screen.getByLabelText('Role') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'coo' } });

    expect(screen.getByText(/only be able to see and act on the gate passes/i)).toBeInTheDocument();
    expect(screen.queryByText(/move the office to the new person/i)).not.toBeInTheDocument();
  });

  it('submitting with an office sends the office key as p_role and no department', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));

    fireEvent.change(screen.getByPlaceholderText('user@company.com'), { target: { value: 'new.ceo@demo.vms' } });
    fireEvent.change(screen.getByPlaceholderText('Min 6 characters'), { target: { value: 'secretpw' } });
    fireEvent.change(screen.getByPlaceholderText('Jane Doe'), { target: { value: 'New Ceo' } });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'ceo' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith(
        'admin_create_user',
        expect.objectContaining({ p_role: 'ceo', p_department_ids: null }),
      ),
    );
  });

  it('submitting with Guard still sends guard as p_role, unchanged', async () => {
    await renderTab();
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));

    fireEvent.change(screen.getByPlaceholderText('user@company.com'), { target: { value: 'new.guard@demo.vms' } });
    fireEvent.change(screen.getByPlaceholderText('Min 6 characters'), { target: { value: 'secretpw' } });
    fireEvent.change(screen.getByPlaceholderText('Jane Doe'), { target: { value: 'New Guard' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith(
        'admin_create_user',
        expect.objectContaining({ p_role: 'guard' }),
      ),
    );
  });
});

describe('Edit User — still Guard and HOD only', () => {
  it('the role select offers only guard and hod, even editing an office holder', async () => {
    await renderTab();
    fireEvent.click(within(rowFor('Priya CEO')).getByRole('button', { name: 'Edit' }));
    const select = screen.getByLabelText('Role') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['guard', 'hod']);
  });

  it('editing an office holder explains the office is changed on the ladder card', async () => {
    await renderTab();
    fireEvent.click(within(rowFor('Priya CEO')).getByRole('button', { name: 'Edit' }));
    expect(screen.getByText(/gate pass approval ladder/i)).toBeInTheDocument();
  });

  it('editing a non-office user shows no ladder note', async () => {
    await renderTab();
    fireEvent.click(within(rowFor('Guard One')).getByRole('button', { name: 'Edit' }));
    expect(screen.queryByText(/gate pass approval ladder/i)).not.toBeInTheDocument();
  });
});

describe('The users list names the office, not bare "staff"', () => {
  it('an office holder reads their office title in the Role column', async () => {
    await renderTab();
    const row = rowFor('Priya CEO');
    expect(within(row).getByText('CEO')).toBeInTheDocument();
    expect(within(row).queryByText('Staff')).not.toBeInTheDocument();
  });

  it('a plain guard still reads Guard', async () => {
    await renderTab();
    const row = rowFor('Guard One');
    expect(within(row).getByText('Guard')).toBeInTheDocument();
  });
});
