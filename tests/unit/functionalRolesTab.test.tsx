// Admin → Functional Roles (client, 2026-08-20).
//
// The screen's own job, as opposed to the list's (functionalRoles.test.ts):
// every role is drawn with its purpose, an approval office is shown by its ONE
// HOLDER rather than a headcount, and the two ways to grant a role are both
// here — Create Role Holder (the Users tab's own modal, not a copy) and the
// approval ladder card.
//
// Mocking pattern copied from approvalDeputyCard.test.tsx, so this file cannot
// drift from how the rest of the admin portal's tests fake Supabase.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROFILES = [
  { id: 'u1', full_name: 'Sanjay Rao', email: 'sanjay@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z' },
  { id: 'u2', full_name: 'Priya Nair', email: 'priya@demo.vms', role: 'hod', created_at: '2026-08-01T00:00:00Z' },
  { id: 'u3', full_name: 'Deepa Menon', email: 'deepa@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z', is_active: false },
];

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
  pub: () => ({ from: () => thenable([{ id: 'd1', name: 'Information Technology', code: 'IT' }]) }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: { id: 'admin1' } } }) } },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchDirectory: () => Promise.resolve(PROFILES),
}));

import FunctionalRolesTab from '../../src/pages/Admin/FunctionalRolesTab';

describe('Admin → Functional Roles', () => {
  it('lists every role with what it is for', async () => {
    render(<FunctionalRolesTab />);
    await waitFor(() => expect(screen.getByTestId('functional-role-list')).toBeTruthy());
    for (const title of [
      'HOD (Head of Department)',
      'Security Guard',
      'Security Head',
      'COO',
      'Finance HOD',
      'CEO',
      'Administrator',
      'Super Administrator',
    ]) {
      expect(screen.getByRole('heading', { name: title })).toBeTruthy();
    }
    expect(screen.getByText(/Signs first on every gate pass/i)).toBeTruthy();
  });

  // An office has one seat; a role has a headcount. Printing "2" against the
  // CEO would describe an authority this database cannot grant twice.
  it('shows an office by its holder and a VMS role by its ACTIVE headcount', async () => {
    render(<FunctionalRolesTab />);
    await waitFor(() => expect(screen.getByText('Sanjay Rao')).toBeTruthy());
    // One active guard of the two guard rows — the suspended one is not counted.
    const guardCard = screen.getByRole('heading', { name: 'Security Guard' }).closest('.card')!;
    expect(guardCard.textContent).toContain('1');
    const cooCard = screen.getByRole('heading', { name: 'COO' }).closest('.card')!;
    expect(cooCard.textContent).toMatch(/Not designated yet/i);
  });

  it('opens the Users tab’s own Add User modal rather than a second one', async () => {
    render(<FunctionalRolesTab />);
    fireEvent.click(screen.getByRole('button', { name: 'Create Role Holder' }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Add User' })).toBeTruthy());
    // …and that modal is what offers the four offices (046).
    expect(screen.getByRole('option', { name: 'CEO' })).toBeTruthy();
  });

  it('carries the approval ladder, which is where an office is actually seated', async () => {
    render(<FunctionalRolesTab />);
    await waitFor(() => expect(screen.getByLabelText('Security Head account')).toBeTruthy());
  });

  // A role cannot be invented here: `profiles.role` is VMS's enum and the four
  // office keys are fixed by a CHECK. The page must not imply otherwise.
  it('says the roles themselves are fixed', async () => {
    render(<FunctionalRolesTab />);
    expect(screen.getByText(/Roles themselves are\s+fixed/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add role$/i })).toBeNull();
  });
});
