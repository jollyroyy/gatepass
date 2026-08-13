// Migration 039: whitelist requests. A blacklist entry can no longer be
// removed directly — an admin requests whitelisting with a justification and
// only the designated CEO may approve (deletes the entry) or reject
// (mandatory note). Pins: the justification is shown in full, non-CEO gets
// no controls, Approve/Reject call the right RPC with the right payload, and
// a blank rejection note never reaches the server.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WhitelistRequestsTab from '../../src/pages/Admin/WhitelistRequestsTab';
import type { WhitelistRequest } from '../../src/types';

function thenable(result: { data: unknown; error: unknown }) {
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return obj;
}

const PENDING_REQUEST: WhitelistRequest = {
  id: 'req-1',
  blacklist_id: 'bl-1',
  list_type: 'company',
  list_value: 'BSC Cargo',
  blocked_reason: 'Repeated late deliveries',
  justification: 'They have new management and have cleared all outstanding dues.',
  requested_by: 'admin-1',
  requested_by_name: 'Priya Admin',
  requested_at: '2026-08-10T09:00:00Z',
  status: 'pending',
  decided_by_name: null,
  decided_at: null,
  decision_note: null,
};

const APPROVED_REQUEST: WhitelistRequest = {
  id: 'req-2',
  blacklist_id: null,
  list_type: 'vehicle',
  list_value: 'WB09AB1234',
  blocked_reason: 'Unauthorized entry attempt',
  justification: 'Vehicle was sold to a new, unrelated owner.',
  requested_by: 'admin-1',
  requested_by_name: 'Priya Admin',
  requested_at: '2026-08-01T09:00:00Z',
  status: 'approved',
  decided_by_name: 'Rahul CEO',
  decided_at: '2026-08-02T09:00:00Z',
  decision_note: 'Verified the ownership transfer.',
};

let isCeo = true;
let requests: WhitelistRequest[] = [PENDING_REQUEST];

const rpc = vi.fn((name: string) => {
  if (name === 'is_ceo') return thenable({ data: isCeo, error: null });
  if (name === 'list_whitelist_requests') return thenable({ data: requests, error: null });
  if (name === 'approve_whitelist_request') return thenable({ data: null, error: null });
  if (name === 'reject_whitelist_request') return thenable({ data: null, error: null });
  return thenable({ data: null, error: null });
});

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc }),
  pub: () => ({ rpc }),
}));

describe('WhitelistRequestsTab', () => {
  beforeEach(() => {
    rpc.mockClear();
    isCeo = true;
    requests = [PENDING_REQUEST];
  });

  it('renders a pending request with its vendor value and the admin justification', async () => {
    render(<WhitelistRequestsTab />);
    await waitFor(() => {
      expect(screen.getByText('BSC Cargo')).toBeTruthy();
    });
    expect(screen.getByText(/They have new management and have cleared all outstanding dues\./)).toBeTruthy();
  });

  it('a non-CEO sees no Approve and no Reject control', async () => {
    isCeo = false;
    render(<WhitelistRequestsTab />);
    await waitFor(() => {
      expect(screen.getByText('BSC Cargo')).toBeTruthy();
    });
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
    expect(screen.getByText(/Only the designated CEO can approve or reject/)).toBeTruthy();
  });

  it('the CEO pressing Approve and confirming calls approve_whitelist_request with the request id', async () => {
    render(<WhitelistRequestsTab />);
    await waitFor(() => expect(screen.getByText('BSC Cargo')).toBeTruthy());
    fireEvent.click(screen.getByText('Approve'));
    fireEvent.click(screen.getByText('Yes'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('approve_whitelist_request', { p_id: 'req-1' });
    });
  });

  it('rejecting with a blank note does not call reject_whitelist_request and shows a field error', async () => {
    render(<WhitelistRequestsTab />);
    await waitFor(() => expect(screen.getByText('BSC Cargo')).toBeTruthy());
    fireEvent.click(screen.getByText('Reject'));
    fireEvent.click(screen.getByText('Submit Rejection'));
    await waitFor(() => {
      expect(screen.getByText(/reason is required/i)).toBeTruthy();
    });
    expect(rpc).not.toHaveBeenCalledWith('reject_whitelist_request', expect.anything());
  });

  it('rejecting with a note calls reject_whitelist_request with the id and note', async () => {
    render(<WhitelistRequestsTab />);
    await waitFor(() => expect(screen.getByText('BSC Cargo')).toBeTruthy());
    fireEvent.click(screen.getByText('Reject'));
    fireEvent.change(screen.getByPlaceholderText('Reason for rejecting'), {
      target: { value: 'Not enough evidence of a real change.' },
    });
    fireEvent.click(screen.getByText('Submit Rejection'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('reject_whitelist_request', {
        p_id: 'req-1',
        p_note: 'Not enough evidence of a real change.',
      });
    });
  });

  it('a decided approved request renders in the Decided group and offers no controls, even to the CEO', async () => {
    requests = [APPROVED_REQUEST];
    render(<WhitelistRequestsTab />);
    await waitFor(() => expect(screen.getByText('WB09AB1234')).toBeTruthy());
    expect(screen.getByText('Decided')).toBeTruthy();
    expect(screen.getByText('Verified the ownership transfer.')).toBeTruthy();
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
  });
});
