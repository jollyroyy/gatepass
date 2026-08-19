// The guard board says NOTHING about expired passes.
//
// Client, 2026-08-18: "once the pass is expired, just remove it from the
// dashboard... keep a track of the expired in the reports also." An expired pass
// is dead paperwork — `match_pass` refuses it forever, so there is no action a
// guard standing at the barrier can take on one, and a red tile that can only be
// read is a tile that teaches the reader to ignore red.
//
// The record is NOT lost, which was the client's condition: the raising HOD
// still gets the bell notification that opens `/expired/:id` to void it or raise
// a replacement, and Reports has an Expired filter over the whole register
// (tests/unit/reportsFilters.test.tsx). This file is the guard's half of that —
// it fails if a tile, a drill or the old red callout creeps back onto the
// board — which since 2026-08-19 (second pass) is a greeting, two drillable
// summary cards and three quick actions; the two preview tables that used to
// sit under the cards moved onto pages of their own.
//
// The fixture keeps a `pending` + `is_expired` row loaded on purpose: absence
// with nothing to show would prove nothing.
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

describe('GuardDashboard — expired passes are off the board', () => {
  it('names no Expired figure, even with an expired pass loaded', async () => {
    expiredTestRow = pass({ id: 'exp1', pass_number: 'EXP-0001', status: 'pending', is_expired: true });
    renderAt(<GuardDashboard />);
    // The dashboard carries no pass rows since 2026-08-19 — only the greeting
    // and the two drillable summary cards. Wait on the cards themselves,
    // which is the only thing the board renders once its one load resolves.
    await waitFor(() =>
      expect(screen.getByText('Pending OUT (Needs Approval)')).toBeInTheDocument());
    expect(screen.getByText('Pending RGP Return (Needs Verification)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Expired/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Expired$/i)).not.toBeInTheDocument();
  });

  it('renders no red expiry callout', async () => {
    expiredTestRow = pass({ id: 'exp1', pass_number: 'EXP-0001', status: 'pending', is_expired: true });
    renderAt(<GuardDashboard />);
    await waitFor(() =>
      expect(screen.getByText('Pending OUT (Needs Approval)')).toBeInTheDocument());
    expect(screen.queryByText(/expired without reaching the gate/i)).not.toBeInTheDocument();
  });
});
