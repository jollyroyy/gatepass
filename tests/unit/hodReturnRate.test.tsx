// The HOD dashboard's Return Rate card.
//
// Client report, 2026-08-11: "I raised an RGP today, it has not returned yet,
// why is it showing 93%? It should be 0%." — and the number never moved,
// whatever the period filter said.
//
// Cause: Return Rate was the ONE KPI on this page whose value came from the
// `kpis()` RPC (`kpis.returnRate`) instead of from the period-scoped row
// array every other card uses. `kpis()` takes no date parameter and
// aggregates ALL TIME (016), so the card showed a lifetime ratio over every
// RGP the department ever raised — immovable by definition, and flatly
// contradicting the repo invariant that a KPI's number must come from the same
// filtered array as the list its click opens, never a separate aggregate.
//
// The mock below returns `return_rate: 93` from the RPC on purpose. If the
// card ever shows 93% again, the RPC has crept back in as its source.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260811-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    flagged_at: null, hod_reviewed_at: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Drill',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

/** Swapped per test. */
let ROWS: GatePassView[] = [];

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
    const data =
      table === 'v_gate_passes'
        ? eqStatus === 'flagged'
          ? ROWS.filter((r) => r.status === 'flagged')
          : ROWS
        : [];
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
    rpc: (name: string) => {
      // The all-time figure the card used to trust. Deliberately a value no
      // scoped fixture below can produce, so any test reading 93% proves the
      // regression rather than coincidence.
      const data =
        name === 'kpis'
          ? [{
              total: 40, pending: 0, matched: 0, flagged: 0, awaiting_return: 0,
              overdue: 0, raised_today: 0, overdue_value: 0, flagged_rate: 0,
              return_rate: 93,
            }]
          : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t: any = { then: (ok: any, err: any) => Promise.resolve({ data, error: null }).then(ok, err) };
      return t;
    },
  }),
  pub: () => ({ from: () => builder('departments') }),
  supabase: { channel: () => ch, removeChannel: () => undefined },
}));

import Dashboard from '../../src/pages/HOD/Dashboard';

/** The Return Rate KPI card's own value, located via its label so it can
 *  never accidentally match another card's percentage. */
function returnRateValue(): string {
  const label = screen.getByText('Return Rate');
  const card = label.closest('button') ?? label.parentElement!;
  const pct = Array.from(card.querySelectorAll('*')).find((el) => /^\d+%$/.test(el.textContent ?? ''));
  return pct?.textContent ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  ROWS = [];
});

describe('HOD Dashboard — Return Rate', () => {
  it('is 0% when today\'s only RGP is out and has not come back', async () => {
    ROWS = [pass({ id: 'a1', status: 'matched', return_status: 'awaiting_return' })];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Return Rate')).toBeInTheDocument());
    expect(returnRateValue()).toBe('0%');
  });

  it('reaches 100% once that pass is fully returned', async () => {
    ROWS = [pass({ id: 'a1', status: 'matched', return_status: 'returned' })];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Return Rate')).toBeInTheDocument());
    expect(returnRateValue()).toBe('100%');
  });

  it('is 50% for one returned and one still out', async () => {
    ROWS = [
      pass({ id: 'a1', status: 'matched', return_status: 'returned' }),
      pass({ id: 'a2', status: 'matched', return_status: 'awaiting_return' }),
    ];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Return Rate')).toBeInTheDocument());
    expect(returnRateValue()).toBe('50%');
  });

  // An NRGP never enters a return cycle (`return_status` is pinned to
  // 'not_applicable' by gate_passes_return_status_rgp_only), so it must not
  // sit in the denominator and drag the rate down.
  it('ignores NRGPs entirely', async () => {
    ROWS = [
      pass({ id: 'r1', status: 'matched', return_status: 'returned' }),
      pass({ id: 'n1', type: 'NRGP', status: 'matched', return_status: 'not_applicable' }),
      pass({ id: 'n2', type: 'NRGP', status: 'matched', return_status: 'not_applicable' }),
    ];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Return Rate')).toBeInTheDocument());
    expect(returnRateValue()).toBe('100%');
  });

  it('shows 0%, not the RPC figure, when nothing returnable exists at all', async () => {
    ROWS = [pass({ id: 'p1', status: 'pending', return_status: 'not_applicable' })];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Return Rate')).toBeInTheDocument());
    expect(returnRateValue()).toBe('0%');
    expect(screen.queryByText('93%')).toBeNull();
  });

  // The period filter is the whole point: the rate must describe the window
  // the rest of the board describes, not all of history.
  it('tracks the period filter', async () => {
    ROWS = [
      // Today: one RGP still out → 0%.
      pass({ id: 'today1', status: 'matched', return_status: 'awaiting_return' }),
      // Five days ago: returned. Invisible under Today, counted under Weekly.
      pass({ id: 'old1', status: 'matched', return_status: 'returned', created_at: daysAgo(5) }),
    ];
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Return Rate')).toBeInTheDocument());
    expect(returnRateValue()).toBe('0%');

    // Exact name — "Biweekly" also matches a /weekly/i substring.
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    await waitFor(() => expect(returnRateValue()).toBe('50%'));
  });
});
