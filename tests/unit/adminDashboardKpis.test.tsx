// The admin dashboard, rebuilt 2026-08-17 to the client's reference layout.
//
// WHAT THESE TESTS ARE ACTUALLY FOR: the board now has five KPI cards, two
// donuts, a trend line, two ranked bar lists and three panels, and every one of
// them is clickable. The risk that grows with that is not "a chart looks wrong"
// — it is a chart whose LABEL and whose DRILL disagree, which no amount of
// looking at the screen reveals. So the recurring assertion below is: read the
// figure the panel prints, click it, and check the list underneath holds
// exactly that many passes, and exactly those passes.
//
// The file also still covers AllPassesReport's removed status tab group, which
// was moved off that page in the same 2026-08-08 change that made these KPIs
// period-scoped.
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
  for (const m of ['in', 'eq', 'order', 'limit', 'select']) {
    obj[m] = () => thenable(result);
  }
  return obj;
}

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x',
    pass_number: 'RGP-OUT-20260817-0001',
    type: 'RGP',
    direction: 'out',
    status: 'matched',
    return_status: 'not_applicable',
    department_id: 'd1',
    department_name: 'Housekeeping',
    department_code: 'HK',
    raised_by: 'u1',
    raised_by_name: 'HOD One',
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

// Six passes today, one five days old. Distinct visitor names so a drill list
// can be identified row by row.
//
//   raised 6 · cleared 4 · pending 1 · outside 2 · overdue 1
//
// The five-day-old row is awaiting AND overdue, so it must appear in the
// all-time Overdue Returns panel but in no Today-scoped figure at all — that
// single row is what separates "scoped" from "all time" in every assertion here.
const ROWS: GatePassView[] = [
  pass({ id: 't1', visitor_name: 'Alice', created_at: TODAY, status: 'pending' }),
  pass({ id: 't2', visitor_name: 'Bob', created_at: TODAY, status: 'matched', return_status: 'awaiting_return' }),
  pass({
    id: 't3', visitor_name: 'Carol', created_at: TODAY, status: 'matched',
    return_status: 'partially_returned', is_overdue: true, expected_return_date: FIVE_DAYS_AGO,
  }),
  pass({ id: 't4', visitor_name: 'Dan', created_at: TODAY, type: 'NRGP', status: 'matched' }),
  pass({ id: 't5', visitor_name: 'Eve', created_at: TODAY, status: 'flagged' }),
  pass({ id: 't6', visitor_name: 'Fay', created_at: TODAY, status: 'matched', return_status: 'returned' }),
  pass({
    id: 'o1', visitor_name: 'Gus', created_at: FIVE_DAYS_AGO, status: 'matched',
    return_status: 'awaiting_return', is_overdue: true, expected_return_date: FIVE_DAYS_AGO,
  }),
];

const ITEMS = [
  { id: 'i1', gate_pass_id: 't1', name: 'Ladder', quantity: 2 },
  { id: 'i2', gate_pass_id: 't2', name: 'Ladder', quantity: 1 },
  { id: 'i3', gate_pass_id: 't3', name: 'Hydraulic Pump', quantity: 1 },
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
import AllPassesReport from '../../src/pages/Admin/AllPassesReport';

function renderAdmin() {
  render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>,
  );
}

/** The KPI card button whose accessible name starts with this label. Scoped to
 *  the headline row: the status donut labels its slices with the same words. */
function kpi(label: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'Headline figures' })).getByRole('button', {
    name: new RegExp(`^${label}`),
  });
}

/** The headline row is chosen by the category toggle, so a test that wants the
 *  return cards has to say which category it is talking about. */
function pickCategory(label: string) {
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Pass category' })).getByRole('button', { name: label }),
  );
}

/** The panel a drill click opens. Scoped lookups matter here: the ranked bar
 *  lists on the same page also print "2 passes", so an unscoped
 *  `getByText('2 passes')` finds the bar rather than the list and passes for
 *  the wrong reason. */
function drill(): HTMLElement {
  return screen.getByRole('region', { name: 'Selected passes' });
}

/** Waits for the first load to land. */
async function loaded() {
  await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('6'));
}

describe('AdminDashboard — period scope', () => {
  it('defaults to Today, offers the period control, and points at Reports for older data', async () => {
    renderAdmin();
    await loaded();
    expect(screen.getByRole('group', { name: 'Dashboard period' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/all-passes');
  });

  it('excludes the five-day-old pass from every scoped KPI, and includes it under Yearly', async () => {
    renderAdmin();
    await loaded();
    // Pending Return and Overdue Returns live on a returnable board — the
    // unnarrowed row carries the category counters instead.
    pickCategory('RGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('5'));
    expect(kpi('Pending Return')).toHaveTextContent('2');
    expect(kpi('Overdue Returns')).toHaveTextContent('1');

    fireEvent.click(screen.getByRole('button', { name: 'Yearly' }));
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('6'));
    expect(kpi('Pending Return')).toHaveTextContent('3');
    expect(kpi('Overdue Returns')).toHaveTextContent('2');
  });
});

describe('AdminDashboard — the headline KPIs', () => {
  it('matches the seeded Today fixture exactly', async () => {
    renderAdmin();
    await loaded();
    expect(kpi('RGP Out Raised')).toHaveTextContent('5');
    expect(kpi('RGP In Raised')).toHaveTextContent('0');
    expect(kpi('NRGP Out Raised')).toHaveTextContent('1');
    expect(kpi('Pending Approvals')).toHaveTextContent('1');
    expect(kpi('Overdue Returns')).toHaveTextContent('1');

    pickCategory('RGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('5'));
    expect(kpi('Cleared at Gate')).toHaveTextContent('3');
    expect(kpi('Pending Return')).toHaveTextContent('2');
  });

  it('renders each as an unpressed toggle until it is clicked', async () => {
    renderAdmin();
    await loaded();
    for (const label of ['Passes Raised', 'RGP Out Raised', 'RGP In Raised', 'NRGP Out Raised', 'Pending Approvals', 'Overdue Returns']) {
      expect(kpi(label)).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('opens exactly the rows it counted, and only those', async () => {
    renderAdmin();
    await loaded();
    pickCategory('RGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('5'));
    fireEvent.click(kpi('Pending Return'));

    expect(within(drill()).getByText('Still out — not yet returned')).toBeInTheDocument();
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
    expect(within(drill()).getByText('Carol')).toBeInTheDocument();
    // Fay came back; Gus is out of scope. Neither may appear in a list whose
    // own card says 2.
    expect(screen.queryByText('Fay')).not.toBeInTheDocument();
    expect(screen.queryByText('Gus')).not.toBeInTheDocument();
  });

  it('toggles shut on a second click, and one drill replaces another', async () => {
    renderAdmin();
    await loaded();
    const raised = kpi('Passes Raised');

    fireEvent.click(raised);
    expect(raised).toHaveAttribute('aria-pressed', 'true');
    expect(within(drill()).getByText('6 passes')).toBeInTheDocument();

    fireEvent.click(raised);
    expect(raised).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('All passes raised')).not.toBeInTheDocument();

    fireEvent.click(kpi('Pending Approvals'));
    expect(within(drill()).getByText('Waiting on the guard')).toBeInTheDocument();
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();
  });
});

describe('AdminDashboard — the charts drill, and agree with their own labels', () => {
  it('the category donut splits the scoped passes and drills into each slice', async () => {
    renderAdmin();
    await loaded();
    const overview = screen.getByRole('button', { name: /^RGP Out: 5 passes/ });
    // 5 RGP Out of 6 scoped passes.
    expect(overview).toHaveTextContent('5');

    fireEvent.click(overview);
    expect(within(drill()).getByText('RGP Out passes')).toBeInTheDocument();
    expect(within(drill()).getByText('5 passes')).toBeInTheDocument();
    expect(within(drill()).queryByText('Dan')).not.toBeInTheDocument(); // the NRGP
  });

  it('the status mode separates Mismatched, which has no KPI card of its own', async () => {
    renderAdmin();
    await loaded();
    fireEvent.change(screen.getByLabelText('Gate Pass Overview breakdown'), { target: { value: 'status' } });

    const mismatched = screen.getByRole('button', { name: /^Mismatched: 1 pass/ });
    expect(mismatched).toHaveTextContent('1');
    fireEvent.click(mismatched);
    expect(within(drill()).getByText('1 pass')).toBeInTheDocument();
    expect(within(drill()).getByText('Eve')).toBeInTheDocument();
  });

  it('the returnable ring never double-counts an overdue pass as also awaiting', async () => {
    renderAdmin();
    await loaded();
    // Fay returned, Bob is out and on time, Carol is out and late. Three
    // buckets, three passes — not four.
    expect(screen.getByRole('button', { name: /^Returned: 1 pass/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Awaiting Return: 1 pass/ })).toBeInTheDocument();
    // `/^Overdue: 1 pass/` deliberately, not `/^Overdue/` — the KPI card is called
    // "Overdue Returns" and would match too.
    expect(screen.getByRole('button', { name: /^Overdue: 1 pass/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Awaiting Return: 1 pass/ }));
    expect(within(drill()).getByText('Still out, not yet due')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
    expect(within(drill()).queryByText('Carol')).not.toBeInTheDocument();
  });

  it('Top Materials ranks by movement and drills to the passes that carried it', async () => {
    renderAdmin();
    await loaded();
    const ladder = screen.getByRole('button', { name: /^Ladder: 2 passes/ });
    expect(ladder).toHaveTextContent('2');

    fireEvent.click(ladder);
    expect(within(drill()).getByText('Ladder — passes carrying it')).toBeInTheDocument();
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
    expect(within(drill()).getByText('Alice')).toBeInTheDocument();
    expect(within(drill()).getByText('Bob')).toBeInTheDocument();
  });

  it('Department Activity drills into the department it names', async () => {
    renderAdmin();
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: /^Housekeeping: 6 passes/ }));
    expect(within(drill()).getByText('Housekeeping — passes raised')).toBeInTheDocument();
    expect(within(drill()).getByText('6 passes')).toBeInTheDocument();
  });
});

describe('AdminDashboard — the panels', () => {
  it('the pending table lists the pending pass and offers no approve/reject control', async () => {
    renderAdmin();
    await loaded();
    const table = screen.getByRole('table');
    expect(within(table).getByText('RGP-OUT-20260817-0001')).toBeInTheDocument();
    // An admin cannot verify a pass — only a guard can, and only through
    // match_pass/flag_pass. A control here would be a button that always fails.
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reject/ })).not.toBeInTheDocument();
  });

  it('Overdue Returns is all-time and therefore shows the out-of-scope pass too', async () => {
    renderAdmin();
    await loaded();
    // The KPI card, which IS scoped, says 1. This panel says 2, and says why.
    expect(kpi('Overdue Returns')).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: 'View All' }));
    expect(within(drill()).getByText('Past their return date (all time)')).toBeInTheDocument();
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
    expect(within(drill()).getByText('Gus')).toBeInTheDocument();
  });

  it('Recent Activity links each row to the pass, not to a filtered list', async () => {
    renderAdmin();
    await loaded();
    const feed = screen.getByRole('heading', { name: 'Recent Activity' }).closest('section');
    expect(feed).not.toBeNull();
    expect(within(feed as HTMLElement).getAllByRole('link').length).toBeGreaterThan(1);
  });
});

const ROW_A = {
  id: 'p1',
  pass_number: 'RGP-OUT-20260730-0001',
  type: 'RGP',
  department_id: 'd1',
  department_name: 'IT',
  visitor_name: 'Alice',
  material_summary: 'Bolts',
  item_count: 2,
  total_quantity: 10,
  status: 'pending',
  raised_by_name: 'HOD One',
  created_at: '2026-07-29T10:00:00Z',
  vehicle_number: null,
  is_expired: false,
} as unknown as GatePassView;

const ROW_B = {
  ...ROW_A,
  id: 'p2',
  pass_number: 'RGP-OUT-20260730-0002',
  status: 'flagged',
} as unknown as GatePassView;

describe('AllPassesReport status tabs removed', () => {
  it('renders no status filter tab group, but keeps the Status column', () => {
    render(
      <MemoryRouter>
        <AllPassesReport rows={[ROW_A, ROW_B]} onRowsChanged={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('button', { name: /Pending for Gate Approval/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mismatched/ })).not.toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
  });
});
