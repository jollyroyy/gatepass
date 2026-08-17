// THE GATE PASS MANAGEMENT BOARD, rebuilt 2026-08-17 to the client's reference
// layout, as the admin sees it (`/admin-dashboard`).
//
// WHAT THIS FILE IS ACTUALLY FOR. The board has fourteen figures across three
// sections, a three-series trend, a four-bucket ring, a four-tab register, a
// ranked bar list and a gate log — and every one of them is clickable. The risk
// that grows with that is not "a panel looks wrong": it is a panel whose LABEL and
// whose DRILL disagree, which no amount of looking at the screen reveals. So the
// recurring assertion below is: read the figure the panel prints, click it, and
// check the list underneath holds exactly that many passes, and exactly those.
//
// THE SECOND THING IT PINS IS THE SCOPE SPLIT, which is the one way this rebuild
// could be confidently wrong. "RGP Out Today" must move when the period changes;
// "RGP Currently Outside", "RGP Overdue" and the whole Return Watch must NOT,
// because an obligation does not stop being open because the calendar rolled past
// the window it started in. The fixture below therefore contains passes RAISED
// FIVE DAYS AGO that are still out — and those rows are what separates a
// period-scoped figure from a current-state one in every assertion here.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function thenable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  for (const m of ['in', 'eq', 'order', 'limit', 'select']) obj[m] = () => thenable(result);
  return obj;
}

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260817-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Housekeeping', department_code: 'HK',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Alice', visitor_company: null, vehicle_number: null, purpose: null,
    expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Bolts', flagged_at: null, hod_reviewed_at: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

const now = new Date();
const TODAY = now.toISOString();
const TODAY_0900 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 0).toISOString();
const TODAY_1500 = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0).toISOString();
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
const todayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// Six passes. Distinct visitor names so a drill list can be identified row by row.
//
//   raised today 4 (p1 p2 p5 p6) · raised five days ago 2 (p3 p4)
//   still out now 2 (p2 due today, p3 overdue) · returned today 1 (p4)
//   gate movements today 3 (p2 out, p4 returned, p5 NRGP cleared)
const ROWS: GatePassView[] = [
  // RGP waiting at the gate.
  pass({ id: 'p1', visitor_name: 'Alice', created_at: TODAY, status: 'pending' }),
  // RGP cleared out today, due back today.
  pass({
    id: 'p2', visitor_name: 'Bob', created_at: TODAY, status: 'matched', verified_at: TODAY_0900,
    return_status: 'awaiting_return', due_state: 'due_today', expected_return_date: todayDate,
  }),
  // RGP from five days ago, still out and late. In NO period-scoped figure.
  pass({
    id: 'p3', visitor_name: 'Carol', created_at: FIVE_DAYS_AGO, status: 'matched', verified_at: FIVE_DAYS_AGO,
    return_status: 'awaiting_return', is_overdue: true, due_state: 'overdue',
    expected_return_date: '2026-01-02', department_id: 'd2', department_name: 'Engineering',
  }),
  // RGP from five days ago, came back TODAY — a return is dated by the return.
  pass({
    id: 'p4', visitor_name: 'Dan', created_at: FIVE_DAYS_AGO, status: 'matched', verified_at: FIVE_DAYS_AGO,
    return_status: 'returned', actual_return_date: TODAY_1500, expected_return_date: todayDate,
  }),
  // NRGP cleared today.
  pass({
    id: 'p5', visitor_name: 'Eve', pass_number: 'NRGP-OUT-20260817-0001', type: 'NRGP',
    created_at: TODAY, status: 'matched', verified_at: TODAY_0900,
  }),
  // NRGP still waiting at the gate.
  pass({
    id: 'p6', visitor_name: 'Fay', pass_number: 'NRGP-OUT-20260817-0002', type: 'NRGP',
    created_at: TODAY, status: 'pending',
  }),
];

const ITEMS = [
  { id: 'i1', gate_pass_id: 'p2', name: 'Ladder', quantity: 2 },
  { id: 'i2', gate_pass_id: 'p3', name: 'Hydraulic Pump', quantity: 1 },
];

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) =>
      table === 'v_gate_pass_items'
        ? { select: () => thenable({ data: ITEMS, error: null }) }
        : { select: () => thenable({ data: ROWS, error: null }) },
  }),
}));

import AdminDashboard from '../../src/pages/Admin/AdminDashboard';

function renderBoard() {
  render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>,
  );
}

/** The tile in `section` whose words begin with `label`. Scoped to the section:
 *  "Overdue Returns" also names a Quick Summary tile, and the Return Watch tabs
 *  reuse the same vocabulary. */
function tile(section: string, label: string): HTMLElement {
  const group = screen.getByRole('group', { name: `${section} figures` });
  const found = within(group)
    .getAllByRole('button')
    .find((b) => (b.textContent ?? '').startsWith(label));
  if (!found) throw new Error(`no "${label}" tile in ${section}`);
  return found;
}

/** Reads the number a tile prints. The figure follows the label immediately in
 *  the DOM, so this asserts the pairing rather than merely that the digit appears
 *  somewhere on the card. */
function expectFigure(section: string, label: string, value: number): void {
  expect(tile(section, label).textContent).toMatch(new RegExp(`^${label}\\s*${value}(\\D|$)`));
}

function drill(): HTMLElement {
  return screen.getByRole('region', { name: 'Selected passes' });
}

async function loaded(): Promise<void> {
  await waitFor(() => expectFigure('RGP Overview', 'RGP Requests', 1));
}

describe('the board renders the reference sections', () => {
  it('has RGP Overview, NRGP Overview and Quick Summary — and no category toggle', async () => {
    renderBoard();
    await loaded();

    expect(screen.getByRole('group', { name: 'RGP Overview figures' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'NRGP Overview figures' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Quick Summary figures' })).toBeInTheDocument();

    // The toggle the sections replaced. Its whole job was to let a reader see the
    // other category; two sections do that without a button press.
    expect(screen.queryByRole('group', { name: 'Pass category' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Dashboard period' })).toBeInTheDocument();
  });

  it('offers no approve or reject control anywhere', async () => {
    // The reference board has a tick and a cross in its pending rows. An admin
    // cannot verify a pass in this system: transitions are RPC-only, no client
    // holds UPDATE, and `match_pass` refuses anyone who is not security. A tick
    // here would be a button that always fails, on the screen of the person least
    // able to understand why.
    renderBoard();
    await loaded();
    expect(screen.queryByRole('button', { name: /^(Approve|Reject)/ })).not.toBeInTheDocument();
  });
});

describe('the headline figures', () => {
  it('matches the seeded fixture, figure by figure', async () => {
    renderBoard();
    await loaded();

    expectFigure('RGP Overview', 'RGP Requests', 1); // p1, right now
    expectFigure('RGP Overview', 'RGP Out Today', 2); // p1 p2 raised today
    expectFigure('RGP Overview', 'RGP Returned Today', 1); // p4 came back today
    expectFigure('RGP Overview', 'RGP Currently Outside', 2); // p2 p3
    expectFigure('RGP Overview', 'RGP Due Today', 1); // p2
    expectFigure('RGP Overview', 'RGP Overdue', 1); // p3

    expectFigure('NRGP Overview', 'NRGP Out Today', 2); // p5 p6
    expectFigure('NRGP Overview', 'NRGP Cleared Today', 1); // p5
    expectFigure('NRGP Overview', 'NRGP Awaiting Clearance', 1); // p6

    expectFigure('Quick Summary', 'Total Gate Passes Today', 4); // p1 p2 p5 p6
    expectFigure('Quick Summary', 'Total Cleared Today', 2); // p2 p5
    expectFigure('Quick Summary', 'Pending Approvals', 2); // p1 p6
    expectFigure('Quick Summary', 'Overdue Returns', 1); // p3
    expectFigure('Quick Summary', 'Material Currently Outside', 2); // p2 p3
  });

  it('a current-state figure counts a pass raised outside the period; a period figure does not', async () => {
    // THE REGRESSION THIS EXISTS FOR: p3 was raised five days ago and never came
    // back. On a Today-scoped board it is in no "raised" figure at all — and it is
    // exactly the pass "RGP Overdue" is there to surface.
    renderBoard();
    await loaded();

    fireEvent.click(tile('RGP Overview', 'RGP Overdue'));
    expect(within(drill()).getByText('Carol')).toBeInTheDocument();

    fireEvent.click(tile('RGP Overview', 'RGP Out Today'));
    expect(within(drill()).queryByText('Carol')).not.toBeInTheDocument();
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
  });

  it('opens exactly the rows it counted, and toggles shut on a second click', async () => {
    renderBoard();
    await loaded();

    const outside = tile('RGP Overview', 'RGP Currently Outside');
    expect(outside).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(outside);

    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
    expect(within(drill()).getByText('Carol')).toBeInTheDocument();
    expect(tile('RGP Overview', 'RGP Currently Outside')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(tile('RGP Overview', 'RGP Currently Outside'));
    expect(screen.queryByRole('region', { name: 'Selected passes' })).not.toBeInTheDocument();
  });

  it('a return is dated by when the material came back, not by when the pass was raised', async () => {
    renderBoard();
    await loaded();
    fireEvent.click(tile('RGP Overview', 'RGP Returned Today'));
    // p4 was raised five days ago. A board that scoped returns on `created_at`
    // would print 0 here and lose every return of an older pass — which is most
    // of them.
    expect(within(drill()).getByText('Dan')).toBeInTheDocument();
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();
  });

  it('the period control re-labels the period figures and closes an open drill', async () => {
    renderBoard();
    await loaded();

    fireEvent.click(tile('RGP Overview', 'RGP Out Today'));
    expect(drill()).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole('group', { name: 'Dashboard period' })).getByRole('button', { name: 'Weekly' }));

    // A drill CARRIES its rows, so one left open would keep listing passes
    // captured under the old window while every figure around it moved.
    expect(screen.queryByRole('region', { name: 'Selected passes' })).not.toBeInTheDocument();
    expectFigure('RGP Overview', 'RGP Out This Week', 4); // p1 p2 p3 p4
    // The current-state figures do not move — they never were scoped.
    expectFigure('RGP Overview', 'RGP Overdue', 1);
  });
});

describe('RGP Return Watch', () => {
  it('offers all four buckets with their counts, even the empty ones', async () => {
    renderBoard();
    await loaded();

    expect(screen.getByRole('button', { name: /^Overdue \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Due Today \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Due in Next 7 Days \(0\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Due After 7 Days \(0\)/ })).toBeInTheDocument();
  });

  it('lists the selected bucket and drills into the whole of it', async () => {
    renderBoard();
    await loaded();

    const watch = screen.getByRole('button', { name: /^Overdue \(1\)/ }).closest('section') as HTMLElement;
    expect(within(watch).getByText('RGP-OUT-20260817-0001')).toBeInTheDocument();

    fireEvent.click(within(watch).getByRole('button', { name: /^View all overdue/ }));
    expect(within(drill()).getByText('Carol')).toBeInTheDocument();
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();

    // Switching tab re-lists without touching the open drill's rows.
    fireEvent.click(within(watch).getByRole('button', { name: /^Due Today \(1\)/ }));
    fireEvent.click(within(watch).getByRole('button', { name: /^View all due today/ }));
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
  });
});

describe('the panels below', () => {
  it('the status ring totals the material still out, and each segment drills', async () => {
    renderBoard();
    await loaded();

    // Two passes are out: one overdue, one due today. The ring's centre is the
    // whole, and its legend is the split.
    expect(screen.getByRole('img', { name: 'Total Outside: 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Overdue: 1 pass/ }));
    expect(within(drill()).getByText('Carol')).toBeInTheDocument();
  });

  it('today\'s gate activity logs the three movements, and never a raised pass', async () => {
    renderBoard();
    await loaded();

    const log = screen.getByText("Today's Gate Activity").closest('section') as HTMLElement;
    expect(within(log).getByText('RGP Returned')).toBeInTheDocument();
    expect(within(log).getByText('RGP Out')).toBeInTheDocument();
    expect(within(log).getByText('NRGP Cleared')).toBeInTheDocument();
    // p1 and p6 are waiting at the gate — nothing moved, so nothing is logged.
    expect(within(log).queryByText(/NRGP-OUT-20260817-0002/)).not.toBeInTheDocument();
  });

  it('ranks outstanding material by department, and drills into the department it names', async () => {
    renderBoard();
    await loaded();

    const bars = screen.getByText('Department Wise Outstanding RGP').closest('section') as HTMLElement;
    fireEvent.click(within(bars).getByRole('button', { name: /^Engineering: 1 pass/ }));
    expect(within(drill()).getByText('Carol')).toBeInTheDocument();
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();
  });

  it('the movement trend drills into the day it plotted', async () => {
    renderBoard();
    await loaded();

    const days = screen.getAllByRole('button', { name: /movements?$/ });
    const today = days[days.length - 1];
    fireEvent.click(today);
    // p2 out, p4 returned, p5 cleared — three movements, three passes.
    expect(within(drill()).getByText('3 passes')).toBeInTheDocument();
  });
});
