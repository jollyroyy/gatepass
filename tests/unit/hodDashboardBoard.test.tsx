// The HOD dashboard — the same board the admin gets (rebuilt 2026-08-17 to the
// client's reference layout), narrowed to one person.
//
// THREE THINGS THIS FILE EXISTS TO PIN, in order of how quietly they could break:
//
//   1. THE PERSON SCOPE. The client asked for a board that is "only for their
//      department and only for her or him". Department is RLS's job and this test
//      cannot see it; the PERSON half is this page's, and it is a
//      `.eq('raised_by', …)` on every read. The mock below RECORDS the filters it
//      was handed and returns a colleague's pass to any read that did NOT ask for
//      one — so forgetting the filter shows up as a stranger's pass on the board,
//      not as a silent widening nobody notices.
//   2. THE FIGURE/DRILL AGREEMENT. Read what a tile prints, click it, count the
//      list underneath.
//   3. THE THINGS DELIBERATELY DIFFERENT FROM THE ADMIN BOARD — outstanding
//      material ranked by MATERIAL rather than by department (one HOD, one
//      department: a department ranking could only draw one bar at 100% naming the
//      reader's own), and no link to `/all-passes`, which ROLE_ROUTES closes to an
//      HOD.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const ME = 'hod-1';
const COLLEAGUE = 'hod-2';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260817-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: ME, raised_by_name: 'P M Sharma',
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
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

// This HOD's own passes: three raised today, one still out from five days ago.
const MINE: GatePassView[] = [
  pass({ id: 't1', visitor_name: 'Alice', created_at: TODAY, status: 'pending' }),
  pass({
    id: 't2', visitor_name: 'Bob', created_at: TODAY, status: 'matched', verified_at: TODAY_0900,
    return_status: 'awaiting_return', material_summary: 'Ladder',
  }),
  pass({ id: 't3', visitor_name: 'Eve', created_at: TODAY, status: 'flagged', flag_reason: 'Qty short' }),
  pass({
    id: 'o1', visitor_name: 'Gus', created_at: FIVE_DAYS_AGO, status: 'matched', verified_at: FIVE_DAYS_AGO,
    return_status: 'awaiting_return', is_overdue: true, due_state: 'overdue',
    expected_return_date: '2026-01-02', material_summary: 'Hydraulic Pump',
  }),
];

// Never raised by this HOD. RLS would hand it over (same department), so only the
// page's own `.eq('raised_by', …)` keeps it off the board.
const THEIRS = pass({
  id: 'c1', visitor_name: 'Zara', pass_number: 'RGP-OUT-20260817-0099', created_at: TODAY,
  status: 'pending', raised_by: COLLEAGUE, raised_by_name: 'Someone Else',
});

const ITEMS = [
  { id: 'i1', gate_pass_id: 't2', name: 'Ladder', quantity: 2 },
  { id: 'i2', gate_pass_id: 'o1', name: 'Hydraulic Pump', quantity: 1 },
  // Belongs to the colleague's pass. Outstanding-material ranking keeps only lines
  // whose parent pass is in scope, so this must never reach a bar.
  { id: 'i3', gate_pass_id: 'c1', name: 'Scaffold Tower', quantity: 1 },
];

/** Records the `.eq()` filters a query was built with, and answers accordingly.
 *  This is the whole point of the harness: a read that never asked for `raised_by`
 *  gets the colleague's pass mixed in. */
function passQuery() {
  const eqs: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in']) obj[m] = () => obj;
  obj.eq = (col: string, val: string) => {
    eqs[col] = val;
    return obj;
  };
  obj.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => {
    let data = eqs.raised_by === ME ? MINE : [...MINE, THEIRS];
    if (eqs.status) data = data.filter((r) => r.status === eqs.status);
    return Promise.resolve({ data, error: null }).then(ok, err);
  };
  return obj;
}

function simple(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'eq']) obj[m] = () => obj;
  obj.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) => {
      if (table === 'v_gate_passes') return passQuery();
      if (table === 'v_gate_pass_items') return simple(ITEMS);
      return simple([{ department_id: 'd1' }]);
    },
  }),
  pub: () => ({ from: () => simple([{ id: 'd1', name: 'Engineering' }]) }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: ME } }, error: null }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import Dashboard from '../../src/pages/HOD/Dashboard';

function renderBoard() {
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

function tile(section: string, label: string): HTMLElement {
  const group = screen.getByRole('group', { name: `${section} figures` });
  const found = within(group)
    .getAllByRole('button')
    .find((b) => (b.textContent ?? '').startsWith(label));
  if (!found) throw new Error(`no "${label}" tile in ${section}`);
  return found;
}

function expectFigure(section: string, label: string, value: number): void {
  expect(tile(section, label).textContent).toMatch(new RegExp(`^${label}\\s*${value}(\\D|$)`));
}

function drill(): HTMLElement {
  return screen.getByRole('region', { name: 'Selected passes' });
}

async function loaded(): Promise<void> {
  await waitFor(() => expectFigure('Quick Summary', 'Total Gate Passes', 3));
}

describe('the HOD board is scoped to this HOD', () => {
  it('counts only passes this HOD raised', async () => {
    renderBoard();
    await loaded();

    // The colleague's pending pass would push Pending Approvals to 2.
    expectFigure('Quick Summary', 'Pending Approvals', 1);
    expectFigure('RGP Overview', 'RGP Awaiting Clearance', 1);
    expect(screen.queryByText('RGP-OUT-20260817-0099')).not.toBeInTheDocument();
  });

  it('never lists a colleague\'s pass in any drill', async () => {
    renderBoard();
    await loaded();

    fireEvent.click(tile('Quick Summary', 'Pending Approvals'));
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();
    expect(within(drill()).queryByText('Zara')).not.toBeInTheDocument();
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();
  });

  it('names the HOD\'s department in the subtitle', async () => {
    renderBoard();
    await waitFor(() => expect(screen.getByText(/Engineering — passes you raised/)).toBeInTheDocument());
  });
});

describe('the HOD board\'s figures', () => {
  it('matches the fixture', async () => {
    renderBoard();
    await loaded();

    expectFigure('RGP Overview', 'RGP Raised', 3); // t1 t2 t3
    expectFigure('RGP Overview', 'RGP Currently Outside', 2); // t2 o1
    expectFigure('RGP Overview', 'RGP Overdue', 1); // o1
    expectFigure('Quick Summary', 'Total Cleared', 1); // t2
    expectFigure('Quick Summary', 'Overdue Returns', 1);
  });

  it('the all-time overdue pass is in no period figure but is still on the board', async () => {
    renderBoard();
    await loaded();

    fireEvent.click(tile('RGP Overview', 'RGP Raised'));
    expect(within(drill()).queryByText('Gus')).not.toBeInTheDocument();

    fireEvent.click(tile('RGP Overview', 'RGP Overdue'));
    expect(within(drill()).getByText('Gus')).toBeInTheDocument();
  });

  it('a drill row does not repeat the reader\'s own name back at them', async () => {
    renderBoard();
    await loaded();
    fireEvent.click(tile('RGP Overview', 'RGP Currently Outside'));
    expect(within(drill()).queryByText(/P M Sharma/)).not.toBeInTheDocument();
  });
});

describe('what differs from the admin board', () => {
  it('ranks outstanding material by MATERIAL, never by department, and never a colleague line', async () => {
    // One HOD, one department (032), and RLS shows them only that one — a
    // department ranking here could draw a single bar at 100% naming the reader's
    // own department. The material ranking is the same panel asking a question
    // that has an answer.
    //
    // `v_gate_pass_items` carries no `raised_by`, so RLS hands over the WHOLE
    // department's lines including the colleague's Scaffold Tower. Only the
    // panel's own rule — ignore any item whose parent pass is not in `rows` —
    // keeps it off the board.
    renderBoard();
    await loaded();

    const panel = screen.getByText('Material Wise Outstanding RGP').closest('section') as HTMLElement;
    expect(within(panel).getByText('Hydraulic Pump')).toBeInTheDocument();
    expect(within(panel).queryByText('Scaffold Tower')).not.toBeInTheDocument();
    expect(screen.queryByText('Department Wise Outstanding RGP')).not.toBeInTheDocument();
  });

  it('links only to routes an HOD may open', async () => {
    renderBoard();
    await loaded();

    for (const link of screen.getAllByRole('link')) {
      const href = link.getAttribute('href') ?? '';
      expect(href.startsWith('/all-passes')).toBe(false);
    }
    // The register link every panel falls back to. `/all-passes` is the admin's;
    // ROLE_ROUTES closes it to an HOD, so this board must point at `/my-passes`.
    expect(screen.getByRole('link', { name: 'the register' })).toHaveAttribute('href', '/my-passes');
  });

  it('keeps the flagged-review queue, fed unscoped by period', async () => {
    renderBoard();
    await loaded();
    // t3 is flagged and was raised today; the queue is its own unscoped read, and
    // the period filter must never hide an open action item.
    await waitFor(() => expect(screen.getByText(/Qty short/)).toBeInTheDocument());
  });
});
