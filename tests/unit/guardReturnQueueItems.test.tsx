// THE RETURN QUEUE IS COUNTED IN ITEMS, AND THERE IS ONLY ONE OF IT.
//
// Client, 2026-08-24: "in the guard's dashboard, returns for today I do see
// four items but in the pending awaiting verification of return card there are
// only two — all of those four items should be in the Pending RGP Return card
// also … even if it is a partially returned, still a couple of the items are
// waiting … and I think you can remove the Returns Due Today, that card itself
// from the guard's dashboard."
//
// The two figures never disagreed about WHICH passes were due back — both cut
// on the database's own `due_state = 'due_today'`. They disagreed about the
// UNIT: the Quick Action tile counted material LINES and the summary card
// counted PASSES, so four lines across two RGPs read as "4" beside "2" and
// looked like two different queues. It was one queue. It is now counted once,
// in the unit a guard is handed things in, and the tile that counted it the
// other way is gone.
//
// WHAT THIS FILE WILL NOT LET DRIFT BACK:
//   * the card's figure is `rows.length` of the list pressing it opens — the
//     board's oldest invariant, and the thing the old split quietly broke;
//   * a PARTIALLY RETURNED pass still contributes its lines. One line back out
//     of three is not closure and the other two are standing at the barrier;
//   * an OVERDUE pass is still absent. Past its date it belongs to Overdue
//     Returns and to nowhere else (client, 2026-08-23), and widening the unit
//     must not have widened the scope;
//   * "Returns Due Today" is not a tile any more.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260824-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: '{"n":"Acme Ltd","a":"Pune","v":"9876543210"}',
    vehicle_number: 'MH12AB1234', purpose: 'Servicing',
    expected_return_date: '2026-08-24', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: '2099-01-01T00:00:00Z', created_at: '2026-08-20T09:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'due_today', awaits_approval: false,
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Ladder', flagged_at: null, hod_reviewed_at: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i', gate_pass_id: 'p1', line_no: 1, name: 'Ladder', description: 'Aluminium',
    purpose: 'Servicing', expected_return_date: '2026-08-24', quantity: 1, unit: 'nos',
    serial_no: null, approx_value: null, make_model: null, invoice_no: null, remarks: null,
    returned_qty: 0, returned_at: null, department_id: 'd1', is_open: true,
    created_at: '2026-08-20T09:00:00Z', outstanding_qty: 1,
    pass_number: 'RGP-OUT-20260824-0001', pass_status: 'matched',
    return_status: 'awaiting_return',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// Two RGPs due back TODAY, carrying FOUR lines between them — three on one and
// one on the other, and the second is already PARTIALLY returned.
const DUE_TODAY: GatePassView[] = [
  pass({ id: 'p1', pass_number: 'RGP-OUT-20260824-0001', item_count: 3 }),
  pass({
    id: 'p2', pass_number: 'RGP-OUT-20260824-0002',
    return_status: 'partially_returned', item_count: 1,
  }),
];

// Past its date, and therefore Overdue Returns' business alone.
const LATE = pass({
  id: 'p3', pass_number: 'RGP-OUT-20260801-0009',
  expected_return_date: '2026-08-01', due_state: 'overdue', is_overdue: true, item_count: 2,
});

const OPEN_RETURNS = [...DUE_TODAY, LATE];

const ITEMS: GatePassItemView[] = [
  item({ id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Ladder' }),
  item({ id: 'i2', gate_pass_id: 'p1', line_no: 2, name: 'Cable Drum' }),
  item({ id: 'i3', gate_pass_id: 'p1', line_no: 3, name: 'Drill Machine' }),
  item({ id: 'i4', gate_pass_id: 'p2', line_no: 1, name: 'Bit Set' }),
  // The late pass's lines exist and must be dropped by scope, not by luck.
  item({ id: 'i5', gate_pass_id: 'p3', line_no: 1, name: 'Scaffold Pole' }),
  item({ id: 'i6', gate_pass_id: 'p3', line_no: 2, name: 'Safety Net' }),
];

function builder(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  // Which of the two `v_gate_passes` reads this is: the gate queue filters on
  // `status`, the open-return read filters on `return_status`.
  let axis: 'status' | 'return_status' | null = null;
  for (const m of ['select', 'order', 'limit', 'ilike', 'gte', 'eq', 'or']) obj[m] = () => obj;
  obj.in = (col: string) => {
    if (col === 'status' || col === 'return_status') axis = col as typeof axis;
    return obj;
  };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data: unknown[] =
      table === 'v_gate_pass_items' ? ITEMS :
      axis === 'return_status' ? OPEN_RETURNS :
      [];
    return Promise.resolve({ data, error: null }).then(onOk, onErr);
  };
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: [], error: null }) }),
  pub: () => ({ from: () => builder('profiles') }),
  supabase: {
    channel: () => { throw new Error('no realtime'); },
    removeChannel: () => undefined,
  },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchMyProfile: () => Promise.resolve({ full_name: 'Ravi Guard' }),
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';
import GuardDrill from '../../src/pages/Security/GuardDrill';

function renderBoard() {
  render(
    <MemoryRouter initialEntries={['/guard-dashboard']}>
      <Routes>
        <Route path="/guard-dashboard" element={<GuardDashboard />} />
        <Route path="/guard-dashboard/:key" element={<GuardDrill />} />
      </Routes>
    </MemoryRouter>
  );
}

const returnFigure = (): HTMLElement =>
  screen.getByTestId('guard-figure-Due back').querySelector('.gb-figure-value') as HTMLElement;

beforeEach(() => vi.clearAllMocks());

describe('Pending RGP Return counts material lines', () => {
  it('reads 4 for four lines across two passes, one of them partially returned', async () => {
    renderBoard();
    await waitFor(() => expect(returnFigure().textContent).toBe('4'));
  });

  it('says out loud that the figure is items, so "4" cannot read as four passes', async () => {
    renderBoard();
    await waitFor(() => expect(returnFigure().textContent).toBe('4'));
    expect(screen.getByText('items')).toBeTruthy();
  });

  it('leaves the overdue pass out — past its date it is Overdue Returns alone', async () => {
    renderBoard();
    await waitFor(() => expect(returnFigure().textContent).toBe('4'));
    // Six lines exist across the three open passes; only the four due today count.
    expect(returnFigure().textContent).not.toBe('6');
  });

  it('opens a list of exactly the four lines it counted', async () => {
    renderBoard();
    await waitFor(() => expect(returnFigure().textContent).toBe('4'));
    fireEvent.click(returnFigure());

    await waitFor(() => expect(screen.getByText('Ladder')).toBeTruthy());
    expect(screen.getByText('Cable Drum')).toBeTruthy();
    expect(screen.getByText('Drill Machine')).toBeTruthy();
    expect(screen.getByText('Bit Set')).toBeTruthy();
    // The late pass's lines are not on this page.
    expect(screen.queryByText('Scaffold Pole')).toBeNull();
    expect(screen.queryByText('Safety Net')).toBeNull();
  });

  it('heads that page with the same figure, in the same unit', async () => {
    renderBoard();
    await waitFor(() => expect(returnFigure().textContent).toBe('4'));
    fireEvent.click(returnFigure());
    await waitFor(() => expect(screen.getByText('Ladder')).toBeTruthy());
    const heading = screen.getByRole('heading', { name: /Pending RGP Return/ });
    expect(within(heading).getByText(/^4 items$/)).toBeTruthy();
  });
});

describe('Returns Due Today is not a tile any more', () => {
  it('is gone from Quick Actions — one obligation, one figure, one list', async () => {
    renderBoard();
    await waitFor(() => expect(returnFigure().textContent).toBe('4'));
    expect(screen.queryByText(/Returns Due Today/i)).toBeNull();
  });

  it('leaves Scan QR and Overdue Returns standing', async () => {
    renderBoard();
    await waitFor(() => expect(returnFigure().textContent).toBe('4'));
    // "Scan QR" also names the search bar's own button, so the TILE is
    // identified by its route rather than by its words.
    expect(screen.getByRole('link', { name: /Scan QR \/ Pass No\./ })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Overdue Returns/ })).toBeTruthy();
  });
});
