// HOD dashboard: every KPI is a drill (mirrors tests/unit/guardDashboard.test.tsx
// and src/pages/Security/GuardDashboard.tsx). "Recent Passes" was removed
// entirely in favour of these drills, so this also asserts it is gone.
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

/** A timestamp several days in the past — outside the Today scope's day
 *  boundary, so any row using this must appear only under All time. */
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
};

// One row per outcome so every KPI's subset is strict and provable. All of
// these are created "now" (today), so the default Today scope shows them all.
const ALL_ROWS: GatePassView[] = [
  pass({ id: 'p1', pass_number: 'PEND-0001', status: 'pending' }),
  pass({ id: 'm1', pass_number: 'MTCH-0001', status: 'matched' }),
  pass({ id: 'f1', pass_number: 'FLAG-0001', status: 'flagged', flag_reason: 'Qty short' }),
  pass({ id: 'a1', pass_number: 'AWAIT-0001', status: 'matched', return_status: 'awaiting_return' }),
  pass({ id: 'o1', pass_number: 'OVER-0001', status: 'matched', return_status: 'awaiting_return', is_overdue: true }),
  pass({ id: 'rgp1', pass_number: 'RGP-0001', type: 'RGP', status: 'matched' }),
  pass({ id: 'nrgp1', pass_number: 'NRGP-0001', type: 'NRGP', status: 'matched' }),
];

// Raised several days ago — excluded under Today, included under Weekly/Yearly.
const OLD_ROW = pass({ id: 'old1', pass_number: 'OLD-0001', status: 'matched', created_at: daysAgo(5) });
// Raised ~200 days ago — excluded under Today and Weekly, included only under Yearly.
const VERY_OLD_ROW = pass({ id: 'veryold1', pass_number: 'VERYOLD-0001', status: 'matched', created_at: daysAgo(200) });

/** Query builder mock. `v_gate_passes` returns either the flagged review
 *  card's slice (.eq('status','flagged').limit(5)) or the full row set the
 *  dashboard now fetches once and filters client-side for every drill. */
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
    const everyRow = [...ALL_ROWS, OLD_ROW, VERY_OLD_ROW];
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
});

describe('HOD Dashboard — KPI drills', () => {
  it('renders the KPI cards', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    expect(screen.getByText('RGP Issued')).toBeInTheDocument();
    expect(screen.getByText('NRGP Issued')).toBeInTheDocument();
    expect(screen.getByText('Pending Verification')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.getByText('Return Rate')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Return')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    // "Mismatched" appears on the KPI button AND on the flagged-review row's
    // badge — both are the same status word, so assert the union.
    expect(screen.getAllByText('Mismatched').length).toBeGreaterThan(0);
  });

  // The HOD raised every pass on this board, so their own name back at them is
  // noise (client feedback, 2026-08-11). Asserted against the PAGE, not
  // against DrillList's default — the default is `true` for the admin board,
  // so only this proves the HOD dashboard opts out.
  it('omits "Raised By" from the cards a drill reveals', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Total Raised'));
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(screen.queryByText('Raised By')).toBeNull();
    expect(screen.queryByText('HOD One')).toBeNull();
  });

  it('never renders a Recent Passes section', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    expect(screen.queryByText('Recent Passes')).not.toBeInTheDocument();
  });

  it("each KPI's displayed number equals the length of its own drill list", async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    // Default scope is Today, which excludes OLD_ROW.
    // Total = 7, RGP Issued = 6, NRGP Issued = 1, Pending = 1, Matched = 5,
    // Mismatched = 1, Awaiting = 2, Overdue = 1.
    expect(screen.getByText('7')).toBeInTheDocument(); // Total Raised
    const rgpCard = screen.getByText('RGP Issued').closest('button')!;
    expect(rgpCard.textContent).toContain('6');
    const nrgpCard = screen.getByText('NRGP Issued').closest('button')!;
    expect(nrgpCard.textContent).toContain('1');
    const pendingCard = screen.getByText('Pending Verification').closest('button')!;
    expect(pendingCard.textContent).toContain('1');
    const matchedCard = screen.getByText('Matched').closest('button')!;
    expect(matchedCard.textContent).toContain('5');
    const awaitingCard = screen.getByText('Awaiting Return').closest('button')!;
    expect(awaitingCard.textContent).toContain('2');
    const overdueCard = screen.getByText('Overdue').closest('button')!;
    expect(overdueCard.textContent).toContain('1');
  });

  it('is unconditionally today-only and excludes an older pass from every KPI and drill', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    // Total stays 7, never 8 — OLD_ROW is excluded from the count itself, not
    // just hidden from a list.
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByText('8')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Total Raised'));
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(screen.queryByText('OLD-0001')).not.toBeInTheDocument();

    // Matched is the drill OLD_ROW's status would otherwise fall into — confirm
    // it's excluded there too, not just from Total.
    fireEvent.click(screen.getByText('Total Raised'));
    fireEvent.click(screen.getByText('Matched'));
    await waitFor(() => expect(screen.getByText('MTCH-0001')).toBeInTheDocument());
    expect(screen.queryByText('OLD-0001')).not.toBeInTheDocument();
  });

  it('renders a Dashboard period control defaulting to Today', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());
    const group = screen.getByRole('group', { name: 'Dashboard period' });
    expect(group).toBeInTheDocument();
    const todayBtn = screen.getByRole('button', { name: 'Today' });
    expect(todayBtn).toHaveAttribute('aria-pressed', 'true');
    ['Weekly', 'Biweekly', 'Monthly', 'Yearly'].forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('selecting Weekly includes an older pass excluded under Today, and Yearly includes a much older one', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());

    // Default Today: 7 rows, OLD_ROW (5 days ago) and VERY_OLD_ROW (200 days ago) excluded.
    expect(screen.getByText('7')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    // Weekly (last 7 days) includes OLD_ROW but still excludes VERY_OLD_ROW.
    await waitFor(() => expect(screen.getByText('8')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Total Raised'));
    await waitFor(() => expect(screen.getByText('OLD-0001')).toBeInTheDocument());
    expect(screen.queryByText('VERYOLD-0001')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Total Raised'));

    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }));
    // Yearly (last 365 days) includes both older rows.
    await waitFor(() => expect(screen.getByText('9')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Total Raised'));
    await waitFor(() => expect(screen.getByText('VERYOLD-0001')).toBeInTheDocument());
  });

  it("each KPI's number still equals the length of its own drill list under a non-default period", async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }));
    await waitFor(() => expect(screen.getByText('9')).toBeInTheDocument());

    // Matched under Yearly gains OLD_ROW and VERY_OLD_ROW on top of the 5 from Today.
    const matchedCard = screen.getByText('Matched').closest('button')!;
    expect(matchedCard.textContent).toContain('7');

    fireEvent.click(screen.getByText('Matched'));
    await waitFor(() => expect(screen.getByText('MTCH-0001')).toBeInTheDocument());
    expect(screen.getByText('OLD-0001')).toBeInTheDocument();
    expect(screen.getByText('VERYOLD-0001')).toBeInTheDocument();
  });

  it('RGP Issued and NRGP Issued drills list only passes of that type', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());

    fireEvent.click(screen.getByText('NRGP Issued'));
    await waitFor(() => expect(screen.getByText('NRGP-0001')).toBeInTheDocument());
    expect(screen.queryByText('RGP-0001')).not.toBeInTheDocument();
    expect(screen.queryByText('PEND-0001')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('NRGP Issued'));
    fireEvent.click(screen.getByText('RGP Issued'));
    await waitFor(() => expect(screen.getByText('RGP-0001')).toBeInTheDocument());
    expect(screen.queryByText('NRGP-0001')).not.toBeInTheDocument();
  });

  it('clicking Pending Verification opens a list containing only the pending pass', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Pending Verification'));

    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(screen.queryByText('MTCH-0001')).not.toBeInTheDocument();
    expect(screen.queryByText('AWAIT-0001')).not.toBeInTheDocument();
    expect(screen.queryByText('OVER-0001')).not.toBeInTheDocument();
  });

  it('closes the list when the same KPI is clicked again', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Pending Verification'));
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Pending Verification'));
    await waitFor(() => expect(screen.queryByText('PEND-0001')).not.toBeInTheDocument());
  });

  it('swaps the list when a different KPI is clicked', async () => {
    renderAt(<Dashboard />);
    await waitFor(() => expect(screen.getByText('Total Raised')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Awaiting Return'));
    await waitFor(() => expect(screen.getByText('AWAIT-0001')).toBeInTheDocument());
    expect(screen.getByText('OVER-0001')).toBeInTheDocument();
    expect(screen.queryByText('PEND-0001')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Overdue'));
    await waitFor(() => expect(screen.queryByText('AWAIT-0001')).not.toBeInTheDocument());
    expect(screen.getByText('OVER-0001')).toBeInTheDocument();
  });
});
