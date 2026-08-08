// The HOD dashboard's "Expired" KPI drill and its red callout — split into its
// own file (rather than folded into hodDashboardDrills.test.tsx) to keep both
// files under the repo's 300-line cap. Mirrors the mock shape of
// hodDashboardDrills.test.tsx but with a minimal, purpose-built fixture set.
//
// The business rule: a pass reads as "Expired" only while `status ===
// 'pending' && is_expired === true` (gatepass.v_gate_passes derives
// `is_expired`; never recomputed here). A matched/flagged pass is never
// "Expired" regardless of `is_expired`, because it already reached an outcome.
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

// `m1` is `matched` with `is_expired: true` on purpose — it must NEVER appear
// in the Expired drill, the "already reached its outcome" regression guard.
const ROWS: GatePassView[] = [
  pass({ id: 'p1', pass_number: 'PEND-0001', status: 'pending', is_expired: false }),
  pass({ id: 'm1', pass_number: 'MTCH-0001', status: 'matched', is_expired: true }),
];

/** Set per test to add the pending+expired row without a second mock module. */
let expiredTestRow: GatePassView | null = null;

function builder(table: string) {
  let eqStatus: string | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in']) obj[m] = () => obj;
  obj.eq = (col: string, val: string) => {
    if (col === 'status') eqStatus = val;
    return obj;
  };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const everyRow = [...ROWS, ...(expiredTestRow ? [expiredTestRow] : [])];
    const data = table === 'v_gate_passes' ? (eqStatus === 'flagged' ? everyRow.filter((r) => r.status === 'flagged') : everyRow) : [];
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
    from: (table: string) => builder(table),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string) => {
      const data =
        name === 'kpis'
          ? [{ total: 0, pending: 0, matched: 0, flagged: 0, awaiting_return: 0, overdue: 0, raised_today: 0, overdue_value: 0, flagged_rate: 0, return_rate: 0 }]
          : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t: any = { then: (ok: any, err: any) => Promise.resolve({ data, error: null }).then(ok, err) };
      return t;
    },
  }),
  pub: () => ({ from: () => builder('departments') }),
  supabase: {
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import Dashboard from '../../src/pages/HOD/Dashboard';

function renderAt(el: React.ReactElement) {
  return render(<MemoryRouter>{el}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  expiredTestRow = null;
});

describe('HOD Dashboard — Expired drill', () => {
  it('excludes a matched row even when is_expired is true, and the count matches the list', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    const expiredCard = screen.getByText('Expired').closest('button')!;
    expect(expiredCard.textContent).toContain('0');
  });

  it('renders no red callout when nothing has expired', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    expect(screen.queryByText(/expired without reaching the gate/i)).not.toBeInTheDocument();
  });

  it('includes a pending row with is_expired true, and the count equals the list it opens', async () => {
    expiredTestRow = pass({ id: 'exp1', pass_number: 'EXP-0001', status: 'pending', is_expired: true });
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());

    const expiredCard = screen.getByText('Expired').closest('button')!;
    expect(expiredCard.textContent).toContain('1');

    fireEvent.click(screen.getByText('Expired'));
    await waitFor(() => expect(screen.getByText('EXP-0001')).toBeInTheDocument());
    expect(screen.queryByText('MTCH-0001')).not.toBeInTheDocument();
  });

  it('excludes a pending row with is_expired false', async () => {
    expiredTestRow = pass({ id: 'exp2', pass_number: 'EXP-0002', status: 'pending', is_expired: false });
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    const expiredCard = screen.getByText('Expired').closest('button')!;
    expect(expiredCard.textContent).toContain('0');
  });

  it('shows a red callout naming the count once it is greater than zero', async () => {
    expiredTestRow = pass({ id: 'exp1', pass_number: 'EXP-0001', status: 'pending', is_expired: true });
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText(/1 pass expired without reaching the gate/i)).toBeInTheDocument());
  });
});
