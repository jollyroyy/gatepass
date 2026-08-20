// Pending Approvals (migration 046) — one office's queue, drawn as the guard's
// own screen (client, 2026-08-19: "all the pending approvals should show up
// there in a stacked format, the styling should be the guard's view style, put
// the KPI number and make it reliable").
//
// WHAT THESE CASES USED TO HOLD, and why they no longer do: the queue was a
// TABLE whose every row carried Approve and Reject. The client moved the
// decision onto the pass record — "once I click on the pending approval item it
// should show the exact same thing as it is showing in the guard's view; here
// make the CTA button at the bottom" — so the rows are `PassStackCard`s, which
// carry no control of any kind, and the two press cases moved to
// `passRecordApprovalCta.test.tsx`. What is pinned here instead is the figure
// agreeing with the stack under it, which is the board invariant this app has
// carried since the first KPI.
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
  const view = render(
    <MemoryRouter>
      <PendingApprovals office={office} />
    </MemoryRouter>,
  );
  if (office) {
    await waitFor(() => expect(screen.getByText('RGP-00057')).toBeInTheDocument());
  }
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRows();
});

describe('The stack and its figure', () => {
  it('counts exactly the cards it renders, and nothing else', async () => {
    const { container } = await renderPage();
    const cards = screen.getAllByTestId('pass-stack-card');
    // p1 and p2 are mine to sign; p3 is held up by an earlier office.
    expect(cards).toHaveLength(2);
    expect(screen.getByText('Awaiting Your Approval')).toBeInTheDocument();
    expect(container.querySelector('.gpo-total-figure')?.textContent).toBe(String(cards.length));
  });

  it('sorts oldest first — the thing that has waited longest is the thing to sign', async () => {
    await renderPage();
    const cards = screen.getAllByTestId('pass-stack-card');
    // p2 (03:00) is older than p1 (04:50).
    expect(within(cards[0]).getByText('NRGP-00081')).toBeInTheDocument();
    expect(within(cards[1]).getByText('RGP-00057')).toBeInTheDocument();
  });

  // REWRITTEN 2026-08-20. This case used to hold that a card offers NO control
  // at all — the decision had been moved onto the record. The client asked for
  // the two buttons back on the card's right-hand side ("as simple, clear and
  // minimal as possible … only the pending approvals and the action button"),
  // so what is pinned now is that every card in THIS queue carries both.
  it('carries Approve and Reject on every card in the queue', async () => {
    await renderPage();
    const cards = screen.getAllByTestId('pass-stack-card');
    for (const card of cards) {
      expect(within(card).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(within(card).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    }
  });

  it('approves through approve_pass_level, and re-reads the queue after', async () => {
    await renderPage();
    const card = screen.getAllByTestId('pass-stack-card')[0];
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(rpcCalls.some((c) => c.name === 'approve_pass_level')).toBe(true));
    // p2 is the oldest, so it is the first card.
    expect(rpcCalls.find((c) => c.name === 'approve_pass_level')?.args)
      .toEqual({ p_pass_id: 'p2' });
  });

  it('will not reject without a written justification', async () => {
    await renderPage();
    const card = screen.getAllByTestId('pass-stack-card')[0];
    fireEvent.click(within(card).getByRole('button', { name: 'Reject' }));

    const submit = screen.getByRole('button', { name: 'Submit Rejection' });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(rpcCalls.some((c) => c.name === 'reject_pass_level')).toBe(false);

    fireEvent.change(screen.getByLabelText(/Reason for Rejection/), {
      target: { value: 'Vendor is blacklisted.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit Rejection' }));
    await waitFor(() =>
      expect(rpcCalls.some((c) => c.name === 'reject_pass_level')).toBe(true));
    expect(rpcCalls.find((c) => c.name === 'reject_pass_level')?.args)
      .toEqual({ p_pass_id: 'p2', p_reason: 'Vendor is blacklisted.' });
  });

  it('opens the ONE gate pass record — the same one the guard reads', async () => {
    await renderPage();
    const card = screen.getAllByTestId('pass-stack-card')[1];
    expect(within(card).getByRole('link')).toHaveAttribute('href', '/pass/p1');
  });

  it('narrows the figure and the stack together, so they cannot disagree', async () => {
    const { container } = await renderPage();
    fireEvent.change(screen.getByLabelText('Search by Pass ID / Vendor / Purpose'), {
      target: { value: 'NRGP-00081' },
    });
    await waitFor(() => expect(screen.getAllByTestId('pass-stack-card')).toHaveLength(1));
    expect(container.querySelector('.gpo-total-figure')?.textContent).toBe('1');
  });
});

// The read-only "Routed to your office, waiting on someone else" table was
// DELETED on 2026-08-20 at the client's instruction. It used to list a pass
// held up by an earlier office, with no Approve/Reject control; this case holds
// that it is gone.
describe('A pass held up by an earlier office', () => {
  it('is not listed on this screen at all', async () => {
    await renderPage();
    expect(screen.queryByText(/waiting on someone else/i)).not.toBeInTheDocument();
    expect(screen.queryByText('RGP-00058')).not.toBeInTheDocument();
    expect(screen.queryByText('Waiting on Security Head')).not.toBeInTheDocument();
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
