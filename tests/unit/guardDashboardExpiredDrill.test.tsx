// The guard dashboard's "Expired" KPI drill and its red callout — split into
// its own file (rather than folded into guardDashboard.test.tsx) to keep both
// files under the repo's 300-line cap. Mirrors the mock shape of
// guardDashboard.test.tsx but with a minimal, purpose-built fixture set.
//
// The business rule: a pass reads as "Expired" only while `status ===
// 'pending' && is_expired === true` (gatepass.v_gate_passes derives
// `is_expired`; never recomputed here). A matched/flagged pass is never
// "Expired" regardless of `is_expired`, because it already reached an
// outcome. The drill is today-scoped, same source as `pending`.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260804-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 2, total_quantity: 3, returned_quantity: 0,
    material_summary: 'Drill, Ladder',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// `mx1` is `matched` (raised today) with `is_expired: true` on purpose — it
// must never appear in the Expired drill, the "already reached its outcome"
// regression guard.
const RAISED_TODAY: GatePassView[] = [
  pass({ id: 'p1', pass_number: 'PEND-0001', status: 'pending', type: 'RGP', direction: 'out' }),
  pass({ id: 'mx1', pass_number: 'MEXP-0001', status: 'matched', type: 'RGP', direction: 'out', is_expired: true }),
];

/** Set per test to add the pending+expired row without a second mock module. */
let expiredTestRow: GatePassView | null = null;

function builder() {
  let axis: 'created_at' | 'verified_at' | 'return_status' | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'lte', 'lt']) obj[m] = () => obj;
  obj.gte = (col: string) => { axis = col as typeof axis; return obj; };
  obj.eq = (col: string) => { if (col === 'return_status') axis = 'return_status'; return obj; };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data =
      axis === 'verified_at' ? [] :
      axis === 'return_status' ? [] :
      (expiredTestRow ? [...RAISED_TODAY, expiredTestRow] : RAISED_TODAY);
    return Promise.resolve({ data, error: null, count: data.length }).then(onOk, onErr);
  };
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => builder(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string, args: any) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t: any = { then: (ok: any, err?: any) => Promise.resolve({ data: [], error: null }).then(ok, err) };
      return t;
    },
  }),
  pub: () => ({ from: () => builder() }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';

function renderAt(el: React.ReactElement) {
  return render(<MemoryRouter>{el}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  expiredTestRow = null;
});

describe('GuardDashboard — Expired drill', () => {
  it('excludes a matched row even when is_expired is true, and the count matches the list', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Expired/i })).toHaveTextContent('0');
  });

  it('renders no red callout when nothing has expired today', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(screen.queryByText(/expired without reaching the gate/i)).not.toBeInTheDocument();
  });

  it('includes a pending row raised today with is_expired true, and the count equals the list it opens', async () => {
    expiredTestRow = pass({ id: 'exp1', pass_number: 'EXP-0001', status: 'pending', is_expired: true });
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: /^Expired/i })).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: /^Expired/i }));
    await waitFor(() => expect(screen.getByText('EXP-0001')).toBeInTheDocument());
    expect(screen.queryByText('MEXP-0001')).not.toBeInTheDocument();
  });

  it('excludes a pending row with is_expired false', async () => {
    expiredTestRow = pass({ id: 'exp2', pass_number: 'EXP-0002', status: 'pending', is_expired: false });
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /^Expired/i })).toHaveTextContent('0');
  });

  it('shows a red callout naming the count once it is greater than zero', async () => {
    expiredTestRow = pass({ id: 'exp1', pass_number: 'EXP-0001', status: 'pending', is_expired: true });
    renderAt(<GuardDashboard />);
    await waitFor(() =>
      expect(screen.getByText(/1 pass expired without reaching the gate today/i)).toBeInTheDocument(),
    );
  });
});
