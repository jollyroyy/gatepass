// Migration 039's CEO approval chain needs exactly one designated account
// (no `ceo` role — the role enum is VMS-owned). Pins: the designated name
// renders, the "nobody designated" state reads as a warning (no whitelist
// request can be approved), a non-super_admin gets no control, a super_admin
// can designate someone, and an RPC refusal surfaces as a visible error.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CeoApproverCard from '../../src/pages/Admin/CeoApproverCard';

function thenable(result: { data: unknown; error: unknown }) {
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return obj;
}

const ADMIN_A = { id: 'admin-a', email: 'a@x.com', full_name: 'Alice Admin', role: 'admin', department_id: null, created_at: '2026-01-01T00:00:00Z' };
const SUPER_B = { id: 'super-b', email: 'b@x.com', full_name: 'Bob Super', role: 'super_admin', department_id: null, created_at: '2026-01-01T00:00:00Z' };

let rpc: ReturnType<typeof vi.fn>;

function mockDesignated() {
  rpc = vi.fn((name: string, args?: any) => {
    if (name === 'get_ceo_approver') {
      return thenable({
        data: [{ user_id: 'super-b', full_name: 'Bob Super', designated_at: '2026-08-10T10:00:00Z' }],
        error: null,
      });
    }
    if (name === 'admin_list_profiles') {
      const role = args?.p_role;
      if (role === 'admin') return thenable({ data: [ADMIN_A], error: null });
      if (role === 'super_admin') return thenable({ data: [SUPER_B], error: null });
      return thenable({ data: [], error: null });
    }
    if (name === 'set_ceo_approver') return thenable({ data: null, error: null });
    return thenable({ data: null, error: null });
  });
}

function mockUndesignated() {
  rpc = vi.fn((name: string, args?: any) => {
    if (name === 'get_ceo_approver') return thenable({ data: [], error: null });
    if (name === 'admin_list_profiles') {
      const role = args?.p_role;
      if (role === 'admin') return thenable({ data: [ADMIN_A], error: null });
      if (role === 'super_admin') return thenable({ data: [SUPER_B], error: null });
      return thenable({ data: [], error: null });
    }
    if (name === 'set_ceo_approver') return thenable({ data: null, error: null });
    return thenable({ data: null, error: null });
  });
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc: (...args: unknown[]) => (rpc as any)(...args) }),
  pub: () => ({ rpc: (...args: unknown[]) => (rpc as any)(...args) }),
}));

describe('CeoApproverCard', () => {
  beforeEach(() => {
    mockDesignated();
  });

  it("renders the designated CEO's name once loaded", async () => {
    render(<CeoApproverCard isSuperAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Bob Super')).toBeTruthy();
    });
  });

  it('renders a warning when no CEO is designated', async () => {
    mockUndesignated();
    render(<CeoApproverCard isSuperAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText(/no whitelist request can be approved/i)).toBeTruthy();
    });
  });

  it('a non-super_admin sees no designate control', async () => {
    render(<CeoApproverCard isSuperAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Bob Super')).toBeTruthy();
    });
    expect(screen.queryByLabelText('Designate CEO approver')).toBeNull();
    expect(screen.queryByText('Save')).toBeNull();
  });

  it('a super_admin can pick a person and save, calling set_ceo_approver with their id', async () => {
    render(<CeoApproverCard isSuperAdmin />);
    await waitFor(() => {
      expect(screen.getByLabelText('Designate CEO approver')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /Alice Admin/ })).toBeTruthy();
    });

    fireEvent.change(screen.getByLabelText('Designate CEO approver'), { target: { value: 'admin-a' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('set_ceo_approver', { p_user_id: 'admin-a' });
    });
  });

  it('surfaces an RPC refusal as a visible error', async () => {
    rpc = vi.fn((name: string) => {
      if (name === 'get_ceo_approver') {
        return thenable({ data: null, error: { message: 'Only a super admin can designate the CEO approver.' } });
      }
      return thenable({ data: [], error: null });
    });
    render(<CeoApproverCard isSuperAdmin={false} />);
    await waitFor(() => {
      expect(screen.getByText('Only a super admin can designate the CEO approver.')).toBeTruthy();
    });
  });
});
