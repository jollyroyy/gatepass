// The Pending Returns tab (re-added 2026-08-08 per operator request: a guard
// standing at the barrier should see what is still out AT A GLANCE, on its own
// left-sidebar tab — not behind dashboard KPI clicks). It shows EVERY open
// obligation — `awaiting_return` AND `partially_returned` — all-time, no date
// scoping: material that left last week and has not come back is MORE urgent
// today, not less. Each pass renders as a returnable GuardDrillCard so the
// guard can record per-line (and all-at-once) returns from the exact list they
// were looking for. A fully-returned pass must never appear.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LINKS } from '../../src/components/layout/Sidebar';
import { ROLE_ROUTES } from '../../src/lib/roleRoutes';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260804-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 1, total_quantity: 1, returned_quantity: 0,
    material_summary: 'Drill',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const OPEN: GatePassView[] = [
  pass({ id: 'a1', pass_number: 'AWAIT-0001', expected_return_date: '2026-09-01' }),
  pass({ id: 'pr1', pass_number: 'PART-0001', return_status: 'partially_returned',
         returned_quantity: 1, total_quantity: 3, material_summary: 'Ladder',
         expected_return_date: '2026-08-30' }),
  pass({ id: 'o1', pass_number: 'OVER-0001', is_overdue: true, expected_return_date: '2026-07-01' }),
];

const CLOSED: GatePassView[] = [
  pass({ id: 'r1', pass_number: 'BACK-0001', status: 'matched', return_status: 'returned',
         returned_quantity: 1, total_quantity: 1 }),
];

// Re-assigned by the empty-state test BEFORE the page mounts.
let API_ROWS: GatePassView[] = [...OPEN, ...CLOSED];

// A returnable pass's lines, as v_gate_pass_items reports them. One line,
// still partly out — the guard ticks it, then presses Record.
const ITEM_ROWS = [
  { id: 'li1', gate_pass_id: 'pr1', line_no: 1, name: 'Ladder', unit: 'nos',
    quantity: 3, returned_qty: 1, returned_at: null, outstanding_qty: 2 },
];

const markReturned = vi.fn(() => Promise.resolve({ data: null, error: null }));
const applyItemReturns = vi.fn((_n: string, _a: unknown) => Promise.resolve({ data: null, error: null }));

/** The page issues ONE query: v_gate_passes restricted to the two open
 *  return_status values, no date filter — mirrors the dashboard's
 *  openObligations axis, minus the today-old falls off. The mock honours the
 *  `.in()` filter so a `returned` pass never leaks into the list. The
 *  v_gate_pass_items query (per-line returns, opened from one card) serves
 *  ITEM_ROWS. */
function builder(table: string) {
  const openStates = ['awaiting_return', 'partially_returned'];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'limit', 'eq', 'order']) obj[m] = () => obj;
  obj.in = () => obj;
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data =
      table === 'v_gate_pass_items' ? ITEM_ROWS :
      API_ROWS.filter((p) =>
        p.return_status === 'awaiting_return' || p.return_status === 'partially_returned');
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string, args: any) => {
      if (name === 'mark_returned') return markReturned(name, args) as never;
      if (name === 'apply_item_returns') return applyItemReturns(name, args) as never;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t: any = { then: (ok: any) => Promise.resolve({ data: [], error: null }).then(ok) };
      return t as never;
    },
  }),
  pub: () => ({ from: () => builder('v_gate_passes') }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import PendingReturns from '../../src/pages/Security/PendingReturns';

function renderPage() {
  return render(<MemoryRouter><PendingReturns /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  API_ROWS = [...OPEN, ...CLOSED];
});

describe('Pending Returns navigation', () => {
  it('offers Pending Returns as a guard tab', () => {
    const guardLinks = ALL_LINKS.filter((n) => n.roles.includes('guard')).map((n) => n.label);
    expect(guardLinks).toContain('Pending Returns');
  });

  it('sits on the left-hand sidebar below Search Pass', () => {
    const guardLinks = ALL_LINKS.filter((n) => n.roles.includes('guard'));
    const labels = guardLinks.map((n) => n.label);
    expect(labels).toEqual(['Dashboard', 'Search Pass', 'Pending Returns']);
  });

  it('lists /returns in the guard route list', () => {
    expect(ROLE_ROUTES.guard).toContain('/returns');
  });
});

describe('PendingReturns page', () => {
  it('renders every pass still out, overdue first, including a partially returned one', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('AWAIT-0001')).toBeInTheDocument());
    expect(screen.getByText('PART-0001')).toBeInTheDocument();
    expect(screen.getByText('OVER-0001')).toBeInTheDocument();

    // Overdue material leads the list.
    const cards = screen.getAllByText(/OVER-0001/).length;
    expect(cards).toBeGreaterThan(0);
  });

  it('does NOT render a pass that already came back', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('AWAIT-0001')).toBeInTheDocument());
    expect(screen.queryByText('BACK-0001')).not.toBeInTheDocument();
  });

  it('visually flags the overdue pass', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('OVER-0001')).toBeInTheDocument());
    const over = screen.getByText('OVER-0001').closest('.card') as HTMLElement;
    expect(over.className).toContain('ring-overdue-500/40');
  });

  it('records a per-item return for the partially returned pass', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('AWAIT-0001')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('Record Returns')[1]); // PART-0001's card
    await waitFor(() => expect(screen.getByText('Return items individually')).toBeInTheDocument());
    // Tick the line, THEN record — nothing reaches the database on the tick
    // alone, which is the point of the tick box (see itemReturnList.test.tsx).
    const box = await screen.findByTestId('tick-item-li1');
    fireEvent.click(box);
    expect(applyItemReturns).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('record-returns'));
    await waitFor(() => expect(applyItemReturns).toHaveBeenCalled());
  });

  it('records an all-at-once return via mark_returned', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('AWAIT-0001')).toBeInTheDocument());
    fireEvent.click(screen.getAllByText('Record Returns')[0]);
    await waitFor(() => expect(screen.getByText('Return items individually')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Return All'));
    await waitFor(() => expect(markReturned).toHaveBeenCalled());
  });

  it('shows the empty state when nothing is out', async () => {
    API_ROWS = [];
    renderPage();
    await waitFor(() => expect(screen.getByText(/nothing.*out|No returnable/i)).toBeInTheDocument());
  });
});