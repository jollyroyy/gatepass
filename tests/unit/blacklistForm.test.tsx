// The blacklist is a VENDOR list (client, 2026-08-13). The Vehicle and Driver
// options are gone from the form — only a vendor can be blacklisted from this
// screen — and the remaining option reads "Vendor", not "Company". The STORED
// value is still `company`: `blacklist_type_valid` (016) and the raise-time
// trigger (027/033) both match on that label, and every existing row carries
// it, so this is a label change and not a data change.
//
// The other half of the same change: an admin can no longer REMOVE an entry.
// `remove_blacklist_entry` was dropped in 039. Removing a vendor from the
// blacklist now means requesting it, with a mandatory justification, and the
// designated CEO approving. These tests pin that the one-click removal cannot
// come back and that the justification is genuinely mandatory client-side.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BlacklistTab from '../../src/pages/Admin/BlacklistTab';

function thenable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return obj;
}

const ENTRY = {
  id: 'b1',
  list_type: 'company',
  list_value: 'BSC Cargo',
  reason: 'Repeated pilferage',
  blocked_by: 'u1',
  created_at: '2026-08-13T06:00:00Z',
};

const state = { entries: [] as unknown[], pending: [] as unknown[] };

function defaultRpc(name: string) {
  if (name === 'list_blacklist_entries') return thenable({ data: state.entries, error: null });
  if (name === 'list_whitelist_requests') return thenable({ data: state.pending, error: null });
  return thenable({ data: null, error: null });
}

const rpc = vi.fn(defaultRpc);

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ rpc }),
  pub: () => ({ rpc }),
}));

beforeEach(() => {
  // mockClear alone leaves a mockImplementation from an earlier test in place,
  // which would silently starve every later test of its rows.
  rpc.mockReset();
  rpc.mockImplementation(defaultRpc);
  state.entries = [];
  state.pending = [];
});

function openForm() {
  render(<BlacklistTab />);
  fireEvent.click(screen.getByText('Add Entry'));
}

function fillReason() {
  fireEvent.change(screen.getByPlaceholderText('Reason for blacklisting'), {
    target: { value: 'not good' },
  });
}

describe('BlacklistTab — the list is vendors only', () => {
  it('offers exactly one type, labelled "Vendor"', () => {
    openForm();
    const select = screen.getByLabelText('Type') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Vendor']);
  });

  it('offers no Vehicle or Driver option', () => {
    openForm();
    const select = screen.getByLabelText('Type') as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain('vehicle');
    expect(values).not.toContain('driver');
  });

  it('still stores the vendor under the `company` list_type the database checks', async () => {
    openForm();
    fireEvent.change(screen.getByPlaceholderText('Vendor name'), { target: { value: 'BSC Cargo' } });
    fillReason();
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('add_blacklist_entry', {
        p_list_type: 'company',
        p_list_value: 'BSC Cargo',
        p_reason: 'not good',
      });
    });
  });

  it('requires a vendor name', async () => {
    openForm();
    fillReason();
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => expect(screen.getByText('Vendor name is required.')).toBeTruthy());
    expect(rpc).not.toHaveBeenCalledWith('add_blacklist_entry', expect.anything());
  });

  it('surfaces the RPC refusal as an error banner', async () => {
    rpc.mockImplementation((name: string) => {
      if (name === 'list_blacklist_entries') return thenable({ data: [], error: null });
      if (name === 'list_whitelist_requests') return thenable({ data: [], error: null });
      if (name === 'add_blacklist_entry') {
        return thenable({ data: null, error: { message: 'Only admins can manage the blacklist.' } });
      }
      return thenable({ data: null, error: null });
    });
    openForm();
    fireEvent.change(screen.getByPlaceholderText('Vendor name'), { target: { value: 'BSC' } });
    fillReason();
    fireEvent.click(screen.getByText('Add to Blacklist'));
    await waitFor(() => {
      expect(screen.getByText('Only admins can manage the blacklist.')).toBeTruthy();
    });
  });
});

describe('BlacklistTab — removal is a request the CEO approves', () => {
  it('offers no Remove control at all', async () => {
    state.entries = [ENTRY];
    render(<BlacklistTab />);
    await waitFor(() => expect(screen.getByText('BSC Cargo')).toBeTruthy());
    expect(screen.queryByText('Remove')).toBeNull();
    expect(screen.getByText('Request Whitelist')).toBeTruthy();
  });

  it('never calls the dropped remove_blacklist_entry RPC', async () => {
    state.entries = [ENTRY];
    render(<BlacklistTab />);
    await waitFor(() => expect(screen.getByText('BSC Cargo')).toBeTruthy());
    fireEvent.click(screen.getByText('Request Whitelist'));
    fireEvent.change(screen.getByPlaceholderText(/Why should this vendor be whitelisted/i), {
      target: { value: 'Dispute settled in writing on 2026-08-01.' },
    });
    fireEvent.click(screen.getByText('Send for CEO Approval'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('request_vendor_whitelist', expect.anything());
    });
    expect(rpc).not.toHaveBeenCalledWith('remove_blacklist_entry', expect.anything());
  });

  it('refuses a blank or token justification before it reaches the database', async () => {
    state.entries = [ENTRY];
    render(<BlacklistTab />);
    await waitFor(() => expect(screen.getByText('BSC Cargo')).toBeTruthy());
    fireEvent.click(screen.getByText('Request Whitelist'));

    fireEvent.click(screen.getByText('Send for CEO Approval'));
    await waitFor(() => expect(screen.getByText(/justification is required/i)).toBeTruthy());
    expect(rpc).not.toHaveBeenCalledWith('request_vendor_whitelist', expect.anything());

    // Matches the DB's own floor (whitelist_requests_justification_substantive).
    fireEvent.change(screen.getByPlaceholderText(/Why should this vendor be whitelisted/i), {
      target: { value: 'ok' },
    });
    fireEvent.click(screen.getByText('Send for CEO Approval'));
    await waitFor(() => expect(screen.getByText(/at least 10 characters/i)).toBeTruthy());
    expect(rpc).not.toHaveBeenCalledWith('request_vendor_whitelist', expect.anything());
  });

  it('sends the justification with the entry id', async () => {
    state.entries = [ENTRY];
    render(<BlacklistTab />);
    await waitFor(() => expect(screen.getByText('BSC Cargo')).toBeTruthy());
    fireEvent.click(screen.getByText('Request Whitelist'));
    fireEvent.change(screen.getByPlaceholderText(/Why should this vendor be whitelisted/i), {
      target: { value: 'Dispute settled in writing on 2026-08-01.' },
    });
    fireEvent.click(screen.getByText('Send for CEO Approval'));
    await waitFor(() => {
      expect(rpc).toHaveBeenCalledWith('request_vendor_whitelist', {
        p_blacklist_id: 'b1',
        p_justification: 'Dispute settled in writing on 2026-08-01.',
      });
    });
  });

  it('shows an entry already awaiting approval as such, and offers no second request', async () => {
    state.entries = [ENTRY];
    state.pending = [{ id: 'r1', blacklist_id: 'b1', status: 'pending' }];
    render(<BlacklistTab />);
    await waitFor(() => expect(screen.getByText('BSC Cargo')).toBeTruthy());
    expect(screen.getByText(/Awaiting CEO approval/i)).toBeTruthy();
    expect(screen.queryByText('Request Whitelist')).toBeNull();
  });
});
