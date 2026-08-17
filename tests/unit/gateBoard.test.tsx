// THE GATE PASS MANAGEMENT BOARD, rebuilt 2026-08-17 to the client's reference
// layout, as the admin sees it (`/admin-dashboard`).
//
// CUT BACK TO TODAY ONLY on 2026-08-17 at the client's instruction: no period
// selector, no trend, no status ring, no return watch, no outstanding ranking —
// sixteen figures across three sections, the list a tile opens, and one ring of
// today's gate activity.
//
// WHAT THIS FILE IS ACTUALLY FOR. Every figure on the board is clickable, and the
// risk that grows with that is not "a panel looks wrong": it is a panel whose
// LABEL and whose DRILL disagree, which no amount of looking at the screen
// reveals. So the recurring assertion below is: read the figure the panel prints,
// click it, and check the list underneath holds exactly that many passes, and
// exactly those.
//
// THE SECOND THING IT PINS IS THE SCOPE SPLIT, which is what makes a today-only
// board safe. "RGP Out Today" counts what was raised today; "RGP Currently
// Outside", "RGP Overdue" and both mismatch tiles must count regardless of day,
// because an obligation does not stop being open because the calendar rolled
// past it. The fixture below therefore contains passes RAISED FIVE DAYS AGO that
// are still out — those rows are what separates a day-scoped figure from a
// current-state one in every assertion here.
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
  // RGP stopped at the gate FIVE DAYS AGO and still undecided. It is in no
  // day-scoped figure at all, and it is exactly the pass the mismatch card
  // exists to surface.
  pass({
    id: 'p7', visitor_name: 'Gita', created_at: FIVE_DAYS_AGO, status: 'flagged',
    verified_at: FIVE_DAYS_AGO, flagged_at: FIVE_DAYS_AGO,
    flag_reason: 'Two ladders, three on the slip', verified_by_name: 'Guard One',
  }),
  // NRGP stopped at the gate today.
  pass({
    id: 'p8', visitor_name: 'Hari', pass_number: 'NRGP-OUT-20260817-0003', type: 'NRGP',
    created_at: TODAY, status: 'flagged', verified_at: TODAY_0900, flagged_at: TODAY_0900,
  }),
];

// ONE read now. The board's second query (`v_gate_pass_items`, for the
// outstanding-material ranking) went with that panel — a mock that still served
// it would hide the fact that nothing asks for it any more.
vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: () => ({ select: () => thenable({ data: ROWS, error: null }) }) }),
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
 *  "Overdue Returns" also names a Quick Summary tile. */
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

    // AND NO PERIOD SELECTOR. The board is today-only, and the control was
    // removed rather than defaulted — one still offering five windows would
    // promise a scope the page below no longer has.
    expect(screen.queryByRole('group', { name: 'Dashboard period' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Weekly' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Today's Gate Pass Summary" })).toBeInTheDocument();
  });

  it('prints no "vs yesterday" delta on any tile', async () => {
    // Client, 2026-08-17. Removed rather than hidden: `BoardWindows` carries no
    // previous window, so there is nothing on this board to compute one from.
    renderBoard();
    await loaded();
    for (const section of ['RGP Overview', 'NRGP Overview', 'Quick Summary']) {
      const group = screen.getByRole('group', { name: `${section} figures` });
      expect(group.textContent).not.toMatch(/vs (yesterday|previous)/i);
      expect(group.textContent).not.toMatch(/[\u2191\u2193]/);
    }
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
    expectFigure('RGP Overview', 'RGP Mismatched at Gate', 1); // p7, five days ago
    expectFigure('RGP Overview', 'RGP Currently Outside', 2); // p2 p3
    expectFigure('RGP Overview', 'RGP Due Today', 1); // p2
    expectFigure('RGP Overview', 'RGP Overdue', 1); // p3

    expectFigure('NRGP Overview', 'NRGP Out Today', 3); // p5 p6 p8
    expectFigure('NRGP Overview', 'NRGP Cleared Today', 1); // p5
    expectFigure('NRGP Overview', 'NRGP Mismatched at Gate', 1); // p8
    expectFigure('NRGP Overview', 'NRGP Awaiting Clearance', 1); // p6

    expectFigure('Quick Summary', 'Total Gate Passes Today', 5); // p1 p2 p5 p6 p8
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

  it('each mismatch tile opens ONLY its own category', async () => {
    // Two cards rather than one, because a stopped RGP and a stopped NRGP have
    // different consequences: the RGP still owes a return, the NRGP does not.
    // A shared card would not tell an admin which kind of material is stopped.
    renderBoard();
    await loaded();

    fireEvent.click(tile('RGP Overview', 'RGP Mismatched at Gate'));
    expect(within(drill()).getByText('Gita')).toBeInTheDocument();
    expect(within(drill()).queryByText('Hari')).not.toBeInTheDocument();

    fireEvent.click(tile('NRGP Overview', 'NRGP Mismatched at Gate'));
    expect(within(drill()).getByText('Hari')).toBeInTheDocument();
    expect(within(drill()).queryByText('Gita')).not.toBeInTheDocument();
  });
});

describe("today's gate activity, as a ring", () => {
  it('draws every movement of today and never a raised pass', async () => {
    renderBoard();
    await loaded();

    // p2 out, p4 returned, p5 cleared. p1/p6/p8 never crossed the barrier, and a
    // flag is not a movement — the material did not go anywhere.
    expect(screen.getByRole('img', { name: 'Movements Today: 3' })).toBeInTheDocument();
    const ring = screen.getByText("Today's Gate Activity").closest('section') as HTMLElement;
    expect(within(ring).getByText('RGP Out')).toBeInTheDocument();
    expect(within(ring).getByText('RGP Returned')).toBeInTheDocument();
    expect(within(ring).getByText('NRGP Cleared')).toBeInTheDocument();
    // A fixed taxonomy, so the empty bucket is still named rather than dropped.
    expect(within(ring).getByText('RGP In')).toBeInTheDocument();
  });

  it('a slice opens exactly the passes it counted', async () => {
    // The ring is a DRILL, which the timeline it replaced was not: its legend
    // number and the list its click opens must be the same array.
    renderBoard();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: /^RGP Returned: 1 pass/ }));
    expect(within(drill()).getByText('Dan')).toBeInTheDocument();
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^NRGP Cleared: 1 pass/ }));
    expect(within(drill()).getByText('Eve')).toBeInTheDocument();
  });
});
