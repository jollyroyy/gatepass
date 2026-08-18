// THE GATE PASS MANAGEMENT BOARD, as the admin sees it (`/admin-dashboard`).
//
// FIVE summary tiles, seven RGP tiles, three NRGP tiles, the Daily Movement
// Trend, the RGP Status Breakdown ring, the Return Watch and Top Items Today —
// with NO "vs yesterday" anywhere, NO gate activity timeline and NO outstanding
// ranking. Every one of those absences is the client removing something by name,
// so each is asserted rather than merely not looked for. The HOD board is the
// same layout with the same removals; tests/unit/hodDashboardBoard.test.tsx
// pins what genuinely differs there.
//
// WHAT THIS FILE IS ACTUALLY FOR. Every figure on the board is clickable, and the
// risk that grows with that is not "a panel looks wrong": it is a panel whose
// LABEL and whose DRILL disagree, which no amount of looking at the screen
// reveals. So the recurring assertion below is: read the figure the panel prints,
// click it, and check the list underneath holds exactly that many passes, and
// exactly those.
//
// THE SECOND THING IT PINS IS THE SCOPE SPLIT. "RGP Raised" counts what was
// raised today; "RGP Currently Outside", "RGP Overdue" and the attention strip
// must count regardless of day, because an obligation does not stop being open
// because the calendar rolled past it. The fixture below therefore contains
// passes RAISED FIVE DAYS AGO that are still out — those rows are what separates
// a day-scoped figure from a current-state one in every assertion here.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';

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

// Nine passes. Distinct visitor names so a drill list can be identified row by row.
//
//   raised today 5 (p1 p2 p5 p6 p8) · raised five days ago 3 (p3 p4 p7) · expired 1 (p9)
//   still out now 2 (p2 due today, p3 overdue) · returned today 1 (p4)
//   stopped at the gate 2 (p7 p8) · expired and void 1 (p9)
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
  // day-scoped figure at all, and it is exactly the pass the attention strip
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
  // RGP raised five days ago that NOBODY EVER PRESENTED. Still `pending` in the
  // enum — expiry is derived, not a status — but `match_pass` refuses it, so it
  // is null and void.
  pass({
    id: 'p9', visitor_name: 'Ila', created_at: FIVE_DAYS_AGO, status: 'pending',
    is_expired: true, expires_at: FIVE_DAYS_AGO,
  }),
];

const ITEMS: GatePassItemView[] = [
  // Ladders travel on two of today's passes; bolts on one. Frequency, not units:
  // the 400 bolts must NOT outrank the two ladder trips.
  { gate_pass_id: 'p1', name: 'Ladder', quantity: 2 },
  { gate_pass_id: 'p2', name: 'ladder', quantity: 1 },
  { gate_pass_id: 'p5', name: 'Bolts', quantity: 400 },
  // Belongs to a pass raised five days ago, so it is in no "today" ranking.
  { gate_pass_id: 'p3', name: 'Scaffold Tower', quantity: 1 },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
].map((i) => i as any as GatePassItemView);

// TWO reads: the passes, and the item lines the two ranked panels need.
vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) => ({
      select: () =>
        thenable({ data: table === 'v_gate_pass_items' ? ITEMS : ROWS, error: null }),
    }),
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

/** The tile in `section` whose words begin with `label`. Scoped to the section
 *  because the two category rows now carry the same three words as each other. */
function tile(section: string, label: string): HTMLElement {
  const group = screen.getByRole('group', { name: `${section} figures` });
  // Buttons AND links: Overdue Returns, RGP Overdue and RGP Due Today NAVIGATE
  // to /overdue and /returns instead of drilling in place (client, 2026-08-18),
  // so those three tiles are anchors. Every other tile is still a button.
  const found = [...within(group).queryAllByRole('button'), ...within(group).queryAllByRole('link')]
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
  await waitFor(() => expectFigure('RGP Overview', 'RGP Raised', 2));
}

describe('the board renders the reference sections', () => {
  it('leads with RGP Overview, then NRGP Overview, and carries no summary row', async () => {
    renderBoard();
    await loaded();

    const rgp = screen.getByRole('group', { name: 'RGP Overview figures' });
    const nrgp = screen.getByRole('group', { name: 'NRGP Overview figures' });
    // Today's Summary is gone from BOTH boards (client, 2026-08-18): it restated
    // the two rows below it, figure for figure.
    expect(screen.queryByRole('group', { name: "Today's Summary figures" })).not.toBeInTheDocument();
    expect(rgp.compareDocumentPosition(nrgp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The toggle the sections replaced. Its whole job was to let a reader see the
    // other category; two sections do that without a button press.
    expect(screen.queryByRole('group', { name: 'Pass category' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gate Pass Management Dashboard' })).toBeInTheDocument();
    // The strapline under it is GONE (client, 2026-08-18): a sentence describing
    // the page describes nothing the figures do not already show.
    expect(screen.queryByText(/Real-time overview/i)).not.toBeInTheDocument();
    expect(document.querySelector('.page-subtitle')).toBeNull();
  });

  it('carries every panel of the reference board, and neither of the two the client removed', async () => {
    renderBoard();
    await loaded();

    for (const panel of [
      'Daily Movement Trend', 'RGP Status Breakdown', 'RGP Return Watch', 'Top Items Today',
    ]) {
      expect(screen.getByText(panel), `${panel} is missing`).toBeInTheDocument();
    }

    // Removed by name: "just remove today's gate activity timeline and put top
    // items by their frequency as a pie chart" (client, 2026-08-17).
    expect(screen.queryByText(/Gate Activity/i)).not.toBeInTheDocument();
    // Removed by name too (client, 2026-08-18): "remove Passes with material
    // still out — top 5". `BoardOutstanding` and `BarList` were deleted, not
    // flagged off, so neither board can grow it back. Return Watch still breaks
    // the same obligations down by how late they are.
    expect(screen.queryByText('Department Wise Outstanding RGP')).not.toBeInTheDocument();
    expect(screen.queryByText(/Passes with material still out/i)).not.toBeInTheDocument();
  });

  it('prints no "vs yesterday" delta on any tile', async () => {
    // Client, 2026-08-17. Removed rather than hidden: `BoardWindows` carries no
    // previous window, so there is nothing on this board to compute one from.
    renderBoard();
    await loaded();
    for (const section of ['RGP Overview', 'NRGP Overview']) {
      const group = screen.getByRole('group', { name: `${section} figures` });
      expect(group.textContent).not.toMatch(/vs (yesterday|previous)/i);
      expect(group.textContent).not.toMatch(/[↑↓]/);
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

    expectFigure('RGP Overview', 'RGP Raised', 2); // p1 p2 raised today
    expectFigure('RGP Overview', 'RGP Awaiting Clearance', 1); // p1 — p9 expired, NOT waiting
    expectFigure('RGP Overview', 'RGP Cleared', 1); // p2 — p3 p4 were raised five days ago
    expectFigure('RGP Overview', 'RGP Returned', 1); // p4 came back today
    expectFigure('RGP Overview', 'RGP Currently Outside', 2); // p2 p3
    expectFigure('RGP Overview', 'RGP Due Today', 1); // p2
    expectFigure('RGP Overview', 'RGP Overdue', 1); // p3

    expectFigure('NRGP Overview', 'NRGP Raised', 3); // p5 p6 p8
    expectFigure('NRGP Overview', 'NRGP Awaiting Clearance', 1); // p6
    expectFigure('NRGP Overview', 'NRGP Cleared', 1); // p5
  });

  it('never counts an expired pass as waiting at the gate', async () => {
    // "NULL AND VOID": `match_pass` refuses an expired pass, so nothing the guard
    // does can clear it. Counting p9 under Requests / Pending Approvals reports a
    // queue that does not exist, on the screen of the person deciding whether the
    // gate is coping.
    renderBoard();
    await loaded();

    fireEvent.click(tile('RGP Overview', 'RGP Awaiting Clearance'));
    expect(within(drill()).queryByText('Ila')).not.toBeInTheDocument();
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();

    fireEvent.click(tile('NRGP Overview', 'NRGP Awaiting Clearance'));
    expect(within(drill()).getByText('Fay')).toBeInTheDocument();
  });

  it('a current-state figure counts a pass raised outside the period; a period figure does not', async () => {
    // THE REGRESSION THIS EXISTS FOR: p3 was raised five days ago and never came
    // back. On a Today-scoped board it is in no "raised" figure at all — and it is
    // exactly the pass "RGP Overdue" is there to surface. That figure now opens
    // the Overdue Items page instead of a drill, so the count is what is asserted
    // here and the rows behind it are pinned by tests/unit/overdueItems.test.ts.
    renderBoard();
    await loaded();

    expectFigure('RGP Overview', 'RGP Overdue', 1);
    expect(tile('RGP Overview', 'RGP Overdue')).toHaveAttribute('href', '/overdue');

    fireEvent.click(tile('RGP Overview', 'RGP Raised'));
    expect(within(drill()).queryByText('Carol')).not.toBeInTheDocument();
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
  });

  // The two figures every role acts on from one screen (client, 2026-08-18).
  it('sends Overdue and Due Today to their own pages, scoped by the reader\'s role', async () => {
    renderBoard();
    await loaded();
    expect(tile('RGP Overview', 'RGP Overdue')).toHaveAttribute('href', '/overdue');
    expect(tile('RGP Overview', 'RGP Due Today')).toHaveAttribute('href', '/returns');
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
    fireEvent.click(tile('RGP Overview', 'RGP Returned'));
    // p4 was raised five days ago. A board that scoped returns on `created_at`
    // would print 0 here and lose every return of an older pass — which is most
    // of them.
    expect(within(drill()).getByText('Dan')).toBeInTheDocument();
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();
  });
});

describe('the attention strip', () => {
  // The two mismatch tiles were dropped to match the reference layout box for
  // box. Neither fact is lost with them: both are counted here, all-time, and
  // both drill.
  it('counts what is stopped and what is void, whatever day it happened', async () => {
    renderBoard();
    await loaded();

    const strip = screen.getByRole('group', { name: 'Needs attention' });
    // p7 (five days ago) and p8 (today) — a day-scoped count would read 1 with
    // two lots of material standing at the barrier.
    expect(within(strip).getByText(/2 passes mismatched at the gate/)).toBeInTheDocument();
    expect(within(strip).getByText(/1 pass expired and void/)).toBeInTheDocument();
  });

  it('each count opens exactly the passes behind it', async () => {
    renderBoard();
    await loaded();
    const strip = screen.getByRole('group', { name: 'Needs attention' });

    fireEvent.click(within(strip).getByText(/mismatched at the gate/));
    expect(within(drill()).getByText('Gita')).toBeInTheDocument();
    expect(within(drill()).getByText('Hari')).toBeInTheDocument();
    expect(within(drill()).queryByText('Ila')).not.toBeInTheDocument();

    fireEvent.click(within(strip).getByText(/expired and void/));
    expect(within(drill()).getByText('Ila')).toBeInTheDocument();
    expect(within(drill()).queryByText('Gita')).not.toBeInTheDocument();
  });
});

describe("today's top items, as a ring", () => {
  it('ranks by how often a material moved, never by how much of it moved', async () => {
    // The client's word is "frequency". One pass carrying 400 bolts is ONE
    // movement; a ladder on two passes is two. Ranking by quantity would put the
    // bolts on top every day and answer a question nobody asked.
    renderBoard();
    await loaded();
    const ring = screen.getByText('Top Items Today').closest('section') as HTMLElement;

    expect(within(ring).getByRole('button', { name: /^Ladder: 2 passes/ })).toBeInTheDocument();
    expect(within(ring).getByRole('button', { name: /^Bolts: 1 pass/ })).toBeInTheDocument();
    // p3's line belongs to a pass raised five days ago — this ring is today's.
    expect(within(ring).queryByText('Scaffold Tower')).not.toBeInTheDocument();
  });

  it('a slice opens exactly the passes it counted', async () => {
    // The ring is a DRILL like every other figure here: its legend number and the
    // list its click opens must be the same array.
    renderBoard();
    await loaded();
    const ring = screen.getByText('Top Items Today').closest('section') as HTMLElement;

    fireEvent.click(within(ring).getByRole('button', { name: /^Ladder: 2 passes/ }));
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
  });
});
