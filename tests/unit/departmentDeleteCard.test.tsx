// Migration 060: an admin's Delete on a department with an ACTIVE HOD raises a
// request instead of deleting it; the HOD decides it here, on their dashboard.
//
// Mocking pattern copied from tests/unit/approvalDeputyCard.test.tsx — same
// `thenable` shape and hoisted `rpc` spy, so this file cannot drift from how
// the rest of the portal fakes Supabase. The RPC is NOT mocked away at the
// `useDepartmentDeleteRequests` module level — the point of this file is to
// pin the exact RPC name and argument shape `decideDepartmentDeletion` sends.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

import DepartmentDeleteRequests from '../../src/components/hod/DepartmentDeleteRequests';
import type { DepartmentDeleteRequest } from '../../src/lib/departmentDeleteRequests';

function makeRequest(over: Partial<DepartmentDeleteRequest> = {}): DepartmentDeleteRequest {
  return {
    id: 'req1',
    department_id: 'dept1',
    department_name: 'Housekeeping',
    department_code: 'HK',
    requested_by: 'admin1',
    requested_name: 'Admin Kumar',
    reason: 'Department is being merged with Facilities.',
    status: 'pending',
    decided_by: null,
    decided_name: null,
    decided_at: null,
    decision_reason: null,
    created_at: '2026-08-20T09:00:00Z',
    can_decide: true,
    ...over,
  };
}

describe('DepartmentDeleteRequests (migration 060)', () => {
  beforeEach(() => rpcSpy.mockClear());

  it('renders nothing when there is nothing to decide', () => {
    // Not this reader's to decide, and one already resolved — an empty
    // bordered strip on a dashboard reads as a panel that failed to load.
    const requests = [
      makeRequest({ id: 'r1', can_decide: false }),
      makeRequest({ id: 'r2', status: 'approved' }),
    ];
    const { container } = render(
      <DepartmentDeleteRequests requests={requests} onDecided={() => {}} />,
    );
    expect(container.querySelector('[data-testid="dept-delete-requests"]')).toBeNull();
  });

  it('names the department, its code, the admin who asked and the reason', () => {
    render(
      <DepartmentDeleteRequests requests={[makeRequest()]} onDecided={() => {}} />,
    );
    expect(screen.getByTestId('dept-delete-requests')).toBeTruthy();
    expect(screen.getByText(/Housekeeping/)).toBeTruthy();
    expect(screen.getByText(/HK/)).toBeTruthy();
    expect(screen.getByText(/Admin Kumar/)).toBeTruthy();
    expect(screen.getByText(/Department is being merged with Facilities\./)).toBeTruthy();
  });

  it('approves in TWO presses: arming alone calls no rpc, confirming calls the RPC with the request id', async () => {
    // The same two-press shape the gate's return entry uses, and for the same
    // reason: the act cannot be undone.
    render(
      <DepartmentDeleteRequests requests={[makeRequest()]} onDecided={() => {}} />,
    );
    fireEvent.click(screen.getByText('Approve deletion'));
    expect(rpcSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/^Confirm — delete /));
    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('hod_decide_department_deletion', {
        p_request_id: 'req1',
        p_approve: true,
        p_reason: '',
      }),
    );
  });

  it('refuses an empty or whitespace-only rejection reason without calling the rpc', async () => {
    render(
      <DepartmentDeleteRequests requests={[makeRequest()]} onDecided={() => {}} />,
    );
    fireEvent.click(screen.getByText('Reject'));

    // Empty box: the button is disabled by construction.
    const confirmBtn = screen.getByText('Confirm rejection') as HTMLButtonElement;
    expect(confirmBtn.disabled).toBe(true);
    fireEvent.click(confirmBtn);
    expect(rpcSpy).not.toHaveBeenCalled();

    // Whitespace-only: still refused, this time by 060's own 5-char rule.
    const textarea = screen.getByLabelText('Reason for refusing *');
    fireEvent.change(textarea, { target: { value: '     ' } });
    fireEvent.click(screen.getByText('Confirm rejection'));
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('sends a real rejection reason TRIMMED, with p_approve false', async () => {
    render(
      <DepartmentDeleteRequests requests={[makeRequest()]} onDecided={() => {}} />,
    );
    fireEvent.click(screen.getByText('Reject'));
    fireEvent.change(screen.getByLabelText('Reason for refusing *'), {
      target: { value: '  Still needed for the mall wing.  ' },
    });
    fireEvent.click(screen.getByText('Confirm rejection'));

    await waitFor(() =>
      expect(rpcSpy).toHaveBeenCalledWith('hod_decide_department_deletion', {
        p_request_id: 'req1',
        p_approve: false,
        p_reason: 'Still needed for the mall wing.',
      }),
    );
  });

  it('calls onDecided after a successful decision, so the list is re-read, never patched', async () => {
    const onDecided = vi.fn(() => Promise.resolve());
    render(
      <DepartmentDeleteRequests requests={[makeRequest()]} onDecided={onDecided} />,
    );
    fireEvent.click(screen.getByText('Approve deletion'));
    fireEvent.click(screen.getByText(/^Confirm — delete /));

    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1));
  });
});
