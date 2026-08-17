// The HOD dashboard, rebuilt 2026-08-17 to the same board layout as the admin
// one: five headline KPIs, the Gate Pass Overview donut, a trend line, the
// pending table, the overdue panel, Top Materials and the Returnable Status
// ring — all drillable.
//
// THREE THINGS THIS FILE EXISTS TO PIN, in order of how quietly they could
// break:
//
//   1. THE PERSON SCOPE. The client asked for a board that is "only for their
//      department and only for her or him". Department is RLS's job and this
//      test cannot see it; the PERSON half is this page's, and it is a
//      `.eq('raised_by', …)` on the query. The mock below therefore records the
//      filters it was handed and returns a colleague's pass for any read that
//      did NOT ask for one — so forgetting the filter shows up as a stranger's
//      pass on the board, not as a silent widening nobody notices.
//   2. THE FIGURE/DRILL AGREEMENT. Read what a card or a chart segment prints,
//      click it, count the list underneath. A donut slice reading 3 that opens
//      4 passes is invisible to the eye and fatal to trust.
//   3. THE THINGS DELIBERATELY ABSENT — Department Activity (one bar on a
//      single-department board) and any link to `/all-passes`, which
//      ROLE_ROUTES closes to an HOD.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const ME = 'hod-1';
const COLLEAGUE = 'hod-2';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x',
    pass_number: 'RGP-OUT-20260817-0001',
    type: 'RGP',
    direction: 'out',
    status: 'matched',
    return_status: 'not_applicable',
    department_id: 'd1',
    department_name: 'Engineering',
    department_code: 'ENG',
    raised_by: ME,
    raised_by_name: 'P M Sharma',
    visitor_name: 'Alice',
    visitor_company: null,
    vehicle_number: null,
    purpose: null,
    expected_return_date: null,
    actual_return_date: null,
    verified_by: null,
    verified_by_name: null,
    verified_at: null,
    flag_reason: null,
    qr_token: 't',
    expires_at: null,
    created_at: new Date().toISOString(),
    is_overdue: false,
    is_expired: false,
    due_state: 'not_applicable',
    item_count: 1,
    total_quantity: 1,
    returned_quantity: 0,
    total_value: 0,
    material_summary: 'Bolts',
    flagged_at: null,
    hod_reviewed_at: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

const TODAY = new Date().toISOString();
const FIVE_DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

// Six of this HOD's passes today, one of theirs five days old.
//
//   raised 6 · cleared 4 · pending 1 · outside 2 · overdue 1 · expired 1
//
// The five-day-old row is awaiting AND overdue, so it must appear in the
// all-time Overdue Returns panel but in no Today-scoped figure at all.
const MINE: GatePassView[] = [
  pass({ id: 't1', visitor_name: 'Alice', created_at: TODAY, status: 'pending' }),
  pass({ id: 't2', visitor_name: 'Bob', created_at: TODAY, status: 'matched', return_status: 'awaiting_return' }),
  pass({
    id: 't3', visitor_name: 'Carol', created_at: TODAY, status: 'matched',
    return_status: 'partially_returned', is_overdue: true, expected_return_date: FIVE_DAYS_AGO,
  }),
  pass({ id: 't4', visitor_name: 'Dan', created_at: TODAY, type: 'NRGP', status: 'matched' }),
  pass({ id: 't5', visitor_name: 'Eve', created_at: TODAY, status: 'flagged', flag_reason: 'Qty short' }),
  pass({ id: 't6', visitor_name: 'Fay', created_at: TODAY, status: 'matched', return_status: 'returned' }),
  pass({
    id: 'o1', visitor_name: 'Gus', created_at: FIVE_DAYS_AGO, status: 'matched',
    return_status: 'awaiting_return', is_overdue: true, expected_return_date: FIVE_DAYS_AGO,
  }),
];

// Never raised by this HOD. RLS would hand it over (same department), so only
// the page's own `.eq('raised_by', …)` keeps it off the board.
const THEIRS = pass({
  id: 'c1', visitor_name: 'Zara', pass_number: 'RGP-OUT-20260817-0099',
  created_at: TODAY, status: 'pending', raised_by: COLLEAGUE, raised_by_name: 'Someone Else',
});

const ITEMS = [
  { id: 'i1', gate_pass_id: 't1', name: 'Ladder', quantity: 2 },
  { id: 'i2', gate_pass_id: 't2', name: 'Ladder', quantity: 1 },
  { id: 'i3', gate_pass_id: 't3', name: 'Hydraulic Pump', quantity: 1 },
  // Belongs to the colleague's pass. `topMaterials` keeps only lines whose
  // parent pass is in scope, so this must never reach a bar.
  { id: 'i4', gate_pass_id: 'c1', name: 'Scaffold Tower', quantity: 1 },
];

/** Records the `.eq()` filters a query was built with, and answers accordingly.
 *  This is the whole point of the harness: a read that never asked for
 *  `raised_by` gets the colleague's pass mixed in. */
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

/** The KPI card button whose accessible name starts with this label. */
function kpi(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${label}`) });
}

/** The panel a drill click opens. Scoped lookups matter: the ranked bar lists
 *  on the same page also print "2 passes". */
function drill(): HTMLElement {
  return screen.getByRole('region', { name: 'Selected passes' });
}

async function loaded() {
  await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('6'));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HOD board — scoped to this HOD, not the whole department', () => {
  it('never shows a pass someone else raised', async () => {
    renderBoard();
    await loaded();
    // 6 today, not 7: the colleague's pending pass is excluded from the COUNT
    // itself, not merely hidden from a list.
    expect(kpi('Pending Approvals')).toHaveTextContent('1');
    expect(screen.queryByText('Zara')).not.toBeInTheDocument();
    expect(screen.queryByText('RGP-OUT-20260817-0099')).not.toBeInTheDocument();

    fireEvent.click(kpi('Pending Approvals'));
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();
    expect(within(drill()).queryByText('Zara')).not.toBeInTheDocument();
  });

  it('drops a colleague’s material line from Top Materials', async () => {
    renderBoard();
    await loaded();
    expect(screen.getByRole('button', { name: /^Ladder: 2 passes/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Scaffold Tower/ })).not.toBeInTheDocument();
  });

  // The HOD raised every pass on this board by construction now.
  it('never prints "Raised By" on a drill card', async () => {
    renderBoard();
    await loaded();
    fireEvent.click(kpi('Passes Raised'));
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByText('Raised By')).toBeNull();
    expect(screen.queryByText('P M Sharma')).toBeNull();
  });
});

describe('HOD board — the five headline KPIs', () => {
  it('matches the seeded Today fixture exactly', async () => {
    renderBoard();
    await loaded();
    expect(kpi('Cleared at Gate')).toHaveTextContent('4');
    expect(kpi('Pending Approvals')).toHaveTextContent('1');
    expect(kpi('Materials Outside')).toHaveTextContent('2');
    expect(kpi('Overdue Returns')).toHaveTextContent('1');
  });

  it('opens exactly the rows it counted, and toggles shut on a second click', async () => {
    renderBoard();
    await loaded();
    const outside = kpi('Materials Outside');

    fireEvent.click(outside);
    expect(outside).toHaveAttribute('aria-pressed', 'true');
    expect(within(drill()).getByText('Still out')).toBeInTheDocument();
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
    expect(within(drill()).getByText('Carol')).toBeInTheDocument();
    // Fay came back; Gus is out of scope.
    expect(screen.queryByText('Fay')).not.toBeInTheDocument();
    expect(screen.queryByText('Gus')).not.toBeInTheDocument();

    fireEvent.click(outside);
    expect(outside).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('region', { name: 'Selected passes' })).not.toBeInTheDocument();
  });

  it('re-scopes every KPI when the period changes', async () => {
    renderBoard();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }));
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('7'));
    expect(kpi('Materials Outside')).toHaveTextContent('3');
    expect(kpi('Overdue Returns')).toHaveTextContent('2');
  });
});

describe('HOD board — the charts, and the one that is deliberately missing', () => {
  it('the category donut splits this HOD’s passes and drills into a slice', async () => {
    renderBoard();
    await loaded();
    // 5 RGP Out of 6 scoped passes; Dan is the NRGP.
    const rgpOut = screen.getByRole('button', { name: /^RGP Out: 5 passes/ });
    fireEvent.click(rgpOut);
    expect(within(drill()).getByText('RGP Out passes')).toBeInTheDocument();
    expect(within(drill()).getByText('5 passes')).toBeInTheDocument();
    expect(within(drill()).queryByText('Dan')).not.toBeInTheDocument();
  });

  it('the status mode carries Mismatched, which has no KPI card of its own', async () => {
    renderBoard();
    await loaded();
    fireEvent.change(screen.getByLabelText('Gate Pass Overview breakdown'), { target: { value: 'status' } });

    fireEvent.click(screen.getByRole('button', { name: /^Mismatched: 1 pass/ }));
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();
    expect(within(drill()).getByText('Eve')).toBeInTheDocument();
  });

  it('the returnable ring never double-counts an overdue pass as also awaiting', async () => {
    renderBoard();
    await loaded();
    expect(screen.getByRole('button', { name: /^Returned: 1 pass/ })).toBeInTheDocument();
    // `/^Overdue: 1 pass/` deliberately — the KPI card is "Overdue Returns".
    expect(screen.getByRole('button', { name: /^Overdue: 1 pass/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Awaiting Return: 1 pass/ }));
    expect(within(drill()).getByText('Still out, not yet due')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
    expect(within(drill()).queryByText('Carol')).not.toBeInTheDocument();
  });

  // One HOD, one department (unique index on hod_departments.hod_id, `032`), and
  // RLS shows them only that one. The ranking could only ever be a single bar at
  // 100% naming the reader's own department.
  it('has no Department Activity panel', async () => {
    renderBoard();
    await loaded();
    expect(screen.queryByText('Department Activity')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Engineering: / })).not.toBeInTheDocument();
  });
});

describe('HOD board — the panels', () => {
  it('keeps the expired banner, which the donut alone would bury', async () => {
    renderBoard();
    await loaded();
    // No pending pass is expired in the fixture, so the banner must be absent
    // rather than rendered empty.
    expect(screen.queryByText(/expired without reaching the gate/)).not.toBeInTheDocument();
  });

  it('Overdue Returns is all-time and therefore shows the out-of-scope pass too', async () => {
    renderBoard();
    await loaded();
    expect(kpi('Overdue Returns')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'View All' }));
    expect(within(drill()).getByText('Past their return date (all time)')).toBeInTheDocument();
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
    expect(within(drill()).getByText('Gus')).toBeInTheDocument();
  });

  it('still surfaces mismatches needing review', async () => {
    renderBoard();
    await loaded();
    expect(screen.getByText('Mismatches needing review')).toBeInTheDocument();
    expect(screen.getByText('Qty short')).toBeInTheDocument();
  });

  // `/all-passes` is admin-only in ROLE_ROUTES. A link to it here would be a
  // dead end that redirects.
  it('never links to the admin-only register', async () => {
    renderBoard();
    await loaded();
    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).not.toBe('/all-passes');
    }
    expect(screen.getByRole('link', { name: 'My Passes' })).toHaveAttribute('href', '/my-passes');
  });
});
