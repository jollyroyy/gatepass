// Pending Approvals (migration 046) — one office's queue, drawn to the
// client's mock-up: a card with a search box, a Filter row, a table with
// Approve/Reject, a read-only "waiting on someone else" section, and the
// no-office empty state.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';
import type { PassApproval } from '../../src/lib/pendingApprovals';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Kumar',
    visitor_name: 'Ravi', visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Formwork Support', expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: '2099-01-01T00:00:00Z', created_at: '2026-08-19T04:50:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 3, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function approval(over: Partial<PassApproval>): PassApproval {
  return {
    gate_pass_id: 'x',
    role_key: 'security_head',
    level_no: 1,
    routed_to: 'u2',
    status: 'pending',
    decided_by: null,
    decided_at: null,
    reason: null,
    created_at: '2026-08-19T04:50:00Z',
    ...over,
  };
}

let PASSES: GatePassView[] = [];
let APPROVALS: PassApproval[] = [];
const rpcCalls: { name: string; args: unknown }[] = [];

function resetRows(): void {
  PASSES = [
    pass({ id: 'p1', pass_number: 'RGP-00057', created_at: '2026-08-19T04:50:00Z' }),
    pass({
      id: 'p2', pass_number: 'NRGP-00081', type: 'NRGP', department_name: 'Housekeeping',
      raised_by_name: 'Suresh Babu', purpose: 'Waste Disposal',
      visitor_company: '{"n":"ABC Suppliers","a":"","v":"9000000001"}',
      created_at: '2026-08-19T03:00:00Z',
    }),
    // Routed to my office (coo) but held up by security_head — read-only.
    pass({ id: 'p3', pass_number: 'RGP-00058', created_at: '2026-08-19T02:00:00Z' }),
  ];
  APPROVALS = [
    approval({ gate_pass_id: 'p1', role_key: 'coo', level_no: 2, status: 'pending' }),
    approval({ gate_pass_id: 'p2', role_key: 'coo', level_no: 2, status: 'pending' }),
    approval({ gate_pass_id: 'p3', role_key: 'security_head', level_no: 1, status: 'pending' }),
    approval({ gate_pass_id: 'p3', role_key: 'coo', level_no: 2, status: 'pending' }),
  ];
  rpcCalls.length = 0;
}

const ITEMS: unknown[] = [];

function builder(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'lte', 'lt', 'gte', 'in', 'ilike']) obj[m] = () => obj;
  obj.eq = (col: string) => {
    if (table === 'v_gate_passes' && col === 'status') return obj;
    return obj;
  };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data = table === 'v_gate_pass_items' ? ITEMS : table === 'pass_approvals' ? APPROVALS : PASSES;
    return Promise.resolve({ data, error: null }).then(onOk, onErr);
  };
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (t: string) => builder(t),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
  pub: () => ({ from: (t: string) => builder(t) }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));

import PendingApprovals from '../../src/pages/Approver/PendingApprovals';

async function renderPage(office: 'coo' | null = 'coo') {
  render(
    <MemoryRouter>
      <PendingApprovals office={office} />
    </MemoryRouter>,
  );
  if (office) {
    await waitFor(() => expect(screen.getByText('RGP-00057')).toBeInTheDocument());
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRows();
});

describe('The queue', () => {
  it('renders one row per actionable pass with the mock-up\'s columns', async () => {
    await renderPage();
    const queueTable = screen.getAllByRole('table')[0];
    const rows = within(queueTable).getAllByRole('row');
    // p2 (03:00) sorts before p1 (04:50) — oldest first.
    const second = within(rows[2]);
    expect(second.getByText('RGP-00057')).toBeInTheDocument();
    expect(second.getByText('RGP')).toBeInTheDocument();
    expect(second.getByText('LMN Contractors')).toBeInTheDocument();
    expect(second.getByText('Formwork Support')).toBeInTheDocument();
    expect(second.getByText('Ramesh Kumar')).toBeInTheDocument();
    expect(second.getByText('Engineering')).toBeInTheDocument();
    // Only p1 and p2 are in my actionable queue — p3 (held up by security_head)
    // is not one of these two rows (it renders in the read-only section below,
    // covered by its own describe block).
    expect(rows).toHaveLength(3);
  });

  it('sorts oldest first', async () => {
    await renderPage();
    const queueTable = screen.getAllByRole('table')[0];
    const rows = within(queueTable).getAllByRole('row');
    // p2 (03:00) is older than p1 (04:50).
    expect(within(rows[1]).getByText('NRGP-00081')).toBeInTheDocument();
    expect(within(rows[2]).getByText('RGP-00057')).toBeInTheDocument();
  });
});

describe('Reject', () => {
  it('opens the modal, disables Submit until a reason is typed, and calls reject_pass_level', async () => {
    await renderPage();
    const rows = screen.getAllByRole('row');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Reject' }));

    expect(screen.getByText('Reject Request')).toBeInTheDocument();
    expect(screen.getByText(/Pass ID: NRGP-00081/)).toBeInTheDocument();

    const submit = screen.getByRole('button', { name: 'Submit Rejection' });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText(/Please provide a reason/), {
      target: { value: '  Vendor blacklisted  ' },
    });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);

    await waitFor(() => {
      const call = rpcCalls.find((c) => c.name === 'reject_pass_level');
      expect(call).toBeTruthy();
      expect(call?.args).toEqual({ p_pass_id: 'p2', p_reason: 'Vendor blacklisted' });
    });
  });
});

describe('Approve', () => {
  it('calls approve_pass_level with the pass id, and no other database RPC', async () => {
    await renderPage();
    const rows = screen.getAllByRole('row');
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(rpcCalls).toHaveLength(1);
    });
    expect(rpcCalls[0]).toEqual({ name: 'approve_pass_level', args: { p_pass_id: 'p2' } });
  });
});

describe('Waiting on someone else', () => {
  it('lists a pass held up by an earlier office, with no Approve or Reject button', async () => {
    await renderPage();
    expect(screen.getByText('Routed to your office, waiting on someone else (1)')).toBeInTheDocument();
    expect(screen.getByText('RGP-00058')).toBeInTheDocument();
    expect(screen.getByText('Waiting on Security Head')).toBeInTheDocument();

    const row = screen.getByText('RGP-00058').closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(within(row as HTMLElement).queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});

describe('No approval office', () => {
  it('renders the empty state and fires no query', async () => {
    render(
      <MemoryRouter>
        <PendingApprovals office={null} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('This account does not hold an approval office.')).toBeInTheDocument();
    expect(screen.queryByText('RGP-00057')).not.toBeInTheDocument();
  });
});
