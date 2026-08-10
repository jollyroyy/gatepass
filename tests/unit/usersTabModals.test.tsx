// UsersTab (src/pages/Admin/UsersTab.tsx) has three popups: Add User, Edit
// User, and the Deactivate confirmation. This pins that each has a working ×
// close control, Escape closes them, and — critically — dismissing the
// Deactivate confirmation never deactivates the account.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const PROFILES = [
  { id: 'u1', full_name: 'Guard One', email: 'guard1@demo.vms', role: 'guard', created_at: '2026-08-01T00:00:00Z' },
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('UsersTab — popup close controls', () => {
  it('Add User: × closes the modal without creating a user', async () => {
    render(<UsersTab />);
    await waitFor(() => expect(screen.getByText('Guard One')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));
    expect(screen.getByRole('heading', { name: 'Add User' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('heading', { name: 'Add User' })).not.toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalledWith('admin_create_user', expect.anything());
  });

  it('Edit User: Escape closes without saving', async () => {
    render(<UsersTab />);
    await waitFor(() => expect(screen.getByText('Guard One')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('heading', { name: 'Edit User' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('heading', { name: 'Edit User' })).not.toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalledWith('admin_update_user', expect.anything());
  });

  it('a click inside the Edit User modal does not close it', async () => {
    render(<UsersTab />);
    await waitFor(() => expect(screen.getByText('Guard One')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('heading', { name: 'Edit User' }));
    expect(screen.getByRole('heading', { name: 'Edit User' })).toBeInTheDocument();
  });
});

// Deactivating a user is destructive — it strips every permission they have.
// The confirmation modal for it existed and was fully wired, but the row's
// "Deactivate" button called handleSoftDelete() directly and never opened it,
// so a single stray click on a dense table row revoked someone's access with
// no confirmation and no undo prompt. The modal was unreachable dead UI.
describe('UsersTab — deactivation is confirmed, never immediate', () => {
  it('the row button opens the confirmation instead of deactivating', async () => {
    render(<UsersTab />);
    await waitFor(() => expect(screen.getByText('Guard One')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    // The confirmation must appear...
    expect(await screen.findByText('Deactivate User?')).toBeInTheDocument();
    // ...and nothing may have been revoked yet.
    expect(rpcSpy).not.toHaveBeenCalledWith('admin_soft_delete_user', expect.anything());
  });

  it('only the confirmed action actually deactivates', async () => {
    render(<UsersTab />);
    await waitFor(() => expect(screen.getByText('Guard One')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await screen.findByText('Deactivate User?');

    // The confirm button inside the dialog, not the row button.
    const confirm = screen.getAllByRole('button', { name: 'Deactivate' })
      .find((b) => b.className.includes('btn-danger'));
    expect(confirm, 'no destructive confirm button found in the dialog').toBeDefined();
    fireEvent.click(confirm!);

    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('admin_soft_delete_user', { p_user_id: 'u1' })
    );
  });
});
