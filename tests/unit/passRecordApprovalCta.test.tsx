// APPROVE / REJECT AT THE FOOT OF THE GATE PASS RECORD (client, 2026-08-19:
// "once I click on the pending approval item it should show the exact same
// thing as it is showing in the guard's view — here make the CTA button, like
// approve or reject, at the bottom in a very proper manner").
//
// The queue at `/approvals` is stacked cards with nothing to press; the
// decision is made here, after the reader has seen the whole pass. So this file
// holds the four things that could go wrong:
//   * the bar is drawn for the office whose TURN it is, and the press is the
//     RPC `approve_pass_level` and nothing else;
//   * an office further up the ladder gets a sentence naming who is holding it,
//     and no button — `approve_pass_level` would only refuse the press;
//   * a reader with no office gets no bar at all;
//   * Reject needs a written reason and sends it to `reject_pass_level`.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';
import type { PassApprovalRow } from '../../src/lib/passApprovalState';

let row: GatePassView;
let approvals: PassApprovalRow[] = [];
const calls: { name: string; args: unknown }[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = vi.fn((name: string, args: any) => {
  calls.push({ name, args });
  if (name === 'get_pass_approvals') return Promise.resolve({ data: approvals, error: null });
  return Promise.resolve({ data: null, error: null });
});

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260819-0005', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering (MEP)', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Yadav',
    visitor_name: 'Ravi Kumar',
    visitor_company: '{"n":"TechFix Solutions","a":"B-108","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Equipment repair', expected_return_date: '2026-08-24', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null,
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: '2099-01-01T00:00:00Z',
    created_at: '2026-08-19T05:00:00Z', updated_at: '2026-08-19T05:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 1, total_quantity: 10, returned_quantity: 0, total_value: 5000,
    material_summary: 'Diesel',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function step(over: Partial<PassApprovalRow>): PassApprovalRow {
  return {
    role_key: 'security_head', level_no: 1, status: 'pending',
    routed_name: 'Demi', decided_name: null, decided_at: null, reason: null,
    ...over,
  };
}

const LADDER: PassApprovalRow[] = [
  step({ role_key: 'security_head', level_no: 1 }),
  step({ role_key: 'coo', level_no: 2, routed_name: 'Sudeshna Pal' }),
];

vi.mock('../../src/supabaseClient', () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order']) o[m] = () => o;
    o.maybeSingle = () => Promise.resolve({ data: row, error: null });
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === 'v_gate_pass_items' ? [] : [], error: null }).then(ok, err);
    return o;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gp: () => ({ from: (t: string) => builder(t), rpc: (n: string, a: any) => rpc(n, a) as never }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u9' } } }) },
      rpc: () => Promise.resolve({ data: null, error: null }),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

const { default: PassDetail } = await import('../../src/pages/Shared/PassDetail');

async function renderAs(office: 'security_head' | 'coo' | null) {
  render(
    <MemoryRouter initialEntries={['/pass/p1']}>
      <Routes>
        <Route path="/pass/:id" element={<PassDetail role={null} office={office} />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  row = pass();
  approvals = LADDER;
});

describe('The office whose turn it is', () => {
  it('gets one Approve and one Reject, at the foot of the record', async () => {
    await renderAs('security_head');
    const bar = await screen.findByTestId('record-approval-actions');
    expect(bar).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    // Which office is signing, and which rung of this pass's own ladder.
    expect(bar.textContent).toContain('Security Head');
    expect(bar.textContent).toContain('Level 1 of 2');
    // The bar comes AFTER the record's table and timeline in the document, so
    // the press is where the reading ends.
    const record = screen.getByTestId('pass-record');
    expect(record.lastElementChild).toBe(bar);
  });

  it('presses through to approve_pass_level, and to no other database RPC', async () => {
    await renderAs('security_head');
    await screen.findByTestId('record-approval-actions');
    calls.length = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => {
      expect(calls.some((c) => c.name === 'approve_pass_level')).toBe(true);
    });
    expect(calls.find((c) => c.name === 'approve_pass_level')?.args).toEqual({ p_pass_id: 'p1' });
    expect(calls.filter((c) => c.name !== 'get_pass_approvals' && c.name !== 'get_approval_ladder'))
      .toHaveLength(1);
  });

  it('rejects only with a written reason, through reject_pass_level', async () => {
    await renderAs('security_head');
    await screen.findByTestId('record-approval-actions');
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    const submit = screen.getByRole('button', { name: 'Submit Rejection' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Please provide a reason/), {
      target: { value: '  Invoice missing  ' },
    });
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    await waitFor(() => {
      const call = calls.find((c) => c.name === 'reject_pass_level');
      expect(call?.args).toEqual({ p_pass_id: 'p1', p_reason: 'Invoice missing' });
    });
  });
});

describe('An office the pass has not reached yet', () => {
  it('is told which office is holding it, and offered nothing to press', async () => {
    await renderAs('coo');
    const bar = await screen.findByTestId('record-approval-actions');
    expect(bar.textContent).toContain('Security Head');
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});

describe('Nothing to sign', () => {
  it('draws no bar for a reader who holds no office', async () => {
    await renderAs(null);
    expect(screen.queryByTestId('record-approval-actions')).not.toBeInTheDocument();
  });

  it('draws no bar once this office has already signed', async () => {
    approvals = LADDER.map((a) => (a.level_no === 1 ? { ...a, status: 'approved' as const } : a));
    await renderAs('security_head');
    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    expect(screen.queryByTestId('record-approval-actions')).not.toBeInTheDocument();
  });

  it('draws no bar on a pass that has left the ladder', async () => {
    row = pass({ status: 'cancelled' });
    await renderAs('security_head');
    expect(screen.queryByTestId('record-approval-actions')).not.toBeInTheDocument();
  });
});
