// The guard's three screens, as they stand after 2026-08-18:
//   * Dashboard owns every number. Seven of the nine figures drill in place;
//     Awaiting Return and Overdue NAVIGATE — to /returns and /overdue, the
//     line-level pages the HOD and the admin get too. No card on the board
//     records a return any more.
//   * Search Pass is search and nothing else — the Pending Queue moved to this
//     board's "Pending for Gate Approval" figure, which is why that figure is
//     the live queue (any date, not expired) rather than today's raises.
//   * Overdue Items replaced the Pending Returns tab.
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

// A number of days ago, well outside "today" by any local-timezone reckoning.
const DAYS_AGO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

// Raised today: one of each category, plus a today-raised outstanding pass.
const RAISED_TODAY: GatePassView[] = [
  pass({ id: 'p1', pass_number: 'PEND-0001', status: 'pending', type: 'RGP', direction: 'out' }),
  pass({ id: 'i1', pass_number: 'RGPIN-0001', status: 'pending', type: 'RGP', direction: 'in' }),
  pass({ id: 'n1', pass_number: 'NRGP-0001', status: 'pending', type: 'NRGP', direction: 'out' }),
];

// Verified today — a separate axis, because a pass raised yesterday and matched
// this morning is still this shift's work.
const VERIFIED_TODAY: GatePassView[] = [
  pass({ id: 'm1', pass_number: 'MTCH-0001', status: 'matched', verified_at: new Date().toISOString() }),
  pass({ id: 'f1', pass_number: 'FLAG-0001', status: 'flagged', flag_reason: 'Qty short',
         verified_at: new Date().toISOString() }),
];

// Open obligations — the QUERY is NOT date-filtered at all; the two drills cut
// this one array at today's date (guardDrills.ts). All three were raised days
// ago, which is the point: neither drill is scoped by when the pass was raised.
//   AWAIT-0001 — due back today      → Awaiting Return
//   OVER-0001  — due back in July    → Overdue (all time)
//   LATER-0001 — due back in October → neither card; it lives on /returns
const OPEN_OBLIGATIONS: GatePassView[] = [
  pass({ id: 'a1', pass_number: 'AWAIT-0001', status: 'matched', type: 'RGP', direction: 'out',
         return_status: 'awaiting_return', expected_return_date: '2026-08-18',
         due_state: 'due_today', created_at: DAYS_AGO }),
  pass({ id: 'o1', pass_number: 'OVER-0001', status: 'matched', type: 'RGP', direction: 'out',
         return_status: 'awaiting_return', expected_return_date: '2026-07-01', is_overdue: true,
         due_state: 'overdue', created_at: DAYS_AGO }),
  pass({ id: 'l1', pass_number: 'LATER-0001', status: 'matched', type: 'RGP', direction: 'out',
         return_status: 'awaiting_return', expected_return_date: '2026-10-01',
         due_state: 'ok', created_at: DAYS_AGO }),
];

// THE GATE QUEUE — its own query now (pending or hod_reviewed, not expired,
// any date), because the list moved here from Search Pass.
const GATE_QUEUE: GatePassView[] = RAISED_TODAY;

// Material lines. The board no longer renders them, but the same fixture keeps
// the items query honest.
const ITEMS = [
  { id: 'it1', gate_pass_id: 'a1', line_no: 1, name: 'Bosch Drill', quantity: 1, unit: 'nos',
    returned_qty: 0, outstanding_qty: 1, expected_return_date: null },
  { id: 'it2', gate_pass_id: 'a1', line_no: 2, name: 'Alu Ladder', quantity: 1, unit: 'nos',
    returned_qty: 1, outstanding_qty: 0, expected_return_date: null },
  { id: 'it3', gate_pass_id: 'o1', line_no: 1, name: 'Cable Coil', quantity: 2, unit: 'nos',
    returned_qty: 0, outstanding_qty: 2, expected_return_date: null },
];

/** Query builder mock: the dashboard issues three queries —
 *  .gte('created_at', start).lt('created_at', end),
 *  .gte('verified_at', start).lt('verified_at', end), and
 *  .in('return_status', ['awaiting_return','partially_returned']) with no date
 *  filter — and filters every drill out of those three sets client-side.
 *
 *  That third query used to be `.eq('return_status', 'awaiting_return')`, which
 *  dropped a part-returned pass out of the ONLY drill from which Record
 *  Returns is reachable. `in` therefore has to set the axis now; leaving it in
 *  the pass-through list silently routed the open-obligations query to
 *  RAISED_TODAY instead. */
function builder(table = 'v_gate_passes') {
  let axis: 'created_at' | 'verified_at' | 'return_status' | 'status' | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'lte', 'lt']) obj[m] = () => obj;
  // `expires_at` rides along with the queue's `.in('status', …)`; only the two
  // day axes select a set, so it must not overwrite one.
  obj.gte = (col: string) => { if (col !== 'expires_at') axis = col as typeof axis; return obj; };
  obj.eq = (col: string) => { if (col === 'return_status') axis = 'return_status'; return obj; };
  obj.in = (col: string) => {
    if (col === 'return_status') axis = 'return_status';
    if (col === 'status') axis = 'status';
    return obj;
  };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data =
      table === 'v_gate_pass_items' ? ITEMS :
      axis === 'verified_at' ? VERIFIED_TODAY :
      axis === 'return_status' ? OPEN_OBLIGATIONS :
      axis === 'status' ? GATE_QUEUE :
      RAISED_TODAY;
    return Promise.resolve({ data, error: null, count: data.length }).then(onOk, onErr);
  };
  return obj;
}

const markReturned = vi.fn(() => Promise.resolve({ data: null, error: null }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const itemReturns = vi.fn((_name: string, _args: any) => Promise.resolve({ data: null, error: null }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) => builder(table),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rpc: (name: string, args: any) => {
      if (name === 'mark_returned') return markReturned(name, args) as never;
      if (name === 'apply_item_returns') return itemReturns(name, args) as never;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const t: any = { then: (ok: any, err?: any) => Promise.resolve({ data: [], error: null }).then(ok, err) };
      return t;
    },
  }),
  pub: () => ({ from: () => builder() }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';
import GateConsole from '../../src/pages/Security/GateConsole';

function renderAt(el: React.ReactElement) {
  return render(<MemoryRouter>{el}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Guard navigation', () => {
  // Search Pass sits directly under Dashboard (client, 2026-08-18): finding a
  // pass is the errand a guard runs dozens of times a shift.
  it('lists Dashboard first, then Search Pass, then Overdue Items', () => {
    const guardLinks = ALL_LINKS.filter((n) => n.roles.includes('guard')).map((n) => n.label);
    expect(guardLinks[0]).toBe('Dashboard');
    expect(guardLinks[1]).toBe('Search Pass');
    expect(guardLinks[2]).toBe('Overdue Items');
    expect(guardLinks).not.toContain('Gate Console');
    // Replaced, not merely renamed (client, 2026-08-18).
    expect(guardLinks).not.toContain('Pending Returns');
  });

  it('keeps both return pages in the guard route list alongside the dashboard', () => {
    expect(ROLE_ROUTES.guard).toContain('/overdue');
    expect(ROLE_ROUTES.guard).toContain('/returns');
    expect(ROLE_ROUTES.guard).toContain('/guard-dashboard');
  });
});

describe('GuardDashboard — KPI drills', () => {
  it('renders every gate KPI, including the two that came from Pending Returns', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('Pending for Gate Approval')).toBeInTheDocument());
    expect(screen.getByText('Mismatch at Gate')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Return')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });

  // Removed at the client's request, 2026-08-11: "remove successful gate
  // passes from the security dashboard." A cleared pass is finished work, and
  // the shift board is for what still needs a guard's attention. The passes
  // themselves are not lost — Reports still holds every one of them, and a
  // returnable pass that came back still shows under Returned & Closed.
  it('no longer offers a Successful Gate Passes drill', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('Pending for Gate Approval')).toBeInTheDocument());
    expect(screen.queryByText('Successful Gate Passes')).not.toBeInTheDocument();
    // The matched pass behind it is gone from the board with it.
    expect(screen.queryByText('MTCH-0001')).not.toBeInTheDocument();
  });

  // ONE RGP COUNTER, NOT TWO (client, 2026-08-18): direction is a property of
  // the pass, not a figure a guard acts on differently, and RGP-in cannot even
  // be raised today.
  it("shows today's movement counters as RGP Raised and NRGP", async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('RGP Raised')).toBeInTheDocument());
    expect(screen.queryByText('RGP Out')).not.toBeInTheDocument();
    expect(screen.queryByText('RGP In')).not.toBeInTheDocument();
    // 'NRGP' with no direction (client, 2026-08-18). getAllByText because the
    // type chip on a queued NRGP pass now reads identically — which is the
    // point: the drill and the chip name the same thing the same way.
    expect(screen.getAllByText('NRGP').length).toBeGreaterThan(0);
  });

  it('titles the board Today at a glance and explains nothing further', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('Today at a glance')).toBeInTheDocument());
    expect(screen.queryByText(/resets at midnight/i)).not.toBeInTheDocument();
  });

  it('drills into RGP Raised and shows both directions, never the NRGP', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('RGP Raised'));

    await waitFor(() => expect(screen.getByText('RGPIN-0001')).toBeInTheDocument());
    expect(screen.getByText('PEND-0001')).toBeInTheDocument();
    expect(screen.queryByText('NRGP-0001')).not.toBeInTheDocument();
  });

  it('shows the pending passes below by default', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    // Pending covers every category raised today, not just RGP Out.
    expect(screen.getByText('RGPIN-0001')).toBeInTheDocument();
    expect(screen.getByText('NRGP-0001')).toBeInTheDocument();
  });

  it('swaps the card list when another KPI is clicked', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Mismatch at Gate'));

    await waitFor(() => expect(screen.getByText('FLAG-0001')).toBeInTheDocument());
    expect(screen.queryByText('PEND-0001')).not.toBeInTheDocument();
  });

  it('shows full pass detail on the drill cards', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    // The pending drill legitimately holds several cards, so match on count.
    expect(screen.getAllByText('Ravi').length).toBeGreaterThan(0);
    expect(screen.getAllByText('WB01AB1234').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Drill, Ladder').length).toBeGreaterThan(0);
  });

  it('sends the two return figures to their own pages instead of drilling', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    const awaiting = screen.getByRole('link', { name: /Awaiting Return/i });
    const overdue = screen.getByRole('link', { name: /^Overdue/i });
    expect(awaiting).toHaveAttribute('href', '/returns');
    expect(overdue).toHaveAttribute('href', '/overdue');

    // And nothing on the board records a return any more — that moved to the
    // two pages, line by line.
    expect(screen.queryByRole('button', { name: /record returns/i })).not.toBeInTheDocument();
    expect(markReturned).not.toHaveBeenCalled();
  });

  it('excludes a pass raised days ago from Pending and Mismatch — and their counts', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    // Pending: only today's three.
    expect(screen.getByRole('button', { name: /Pending for Gate Approval/i })).toHaveTextContent('3');
    expect(screen.queryByText('AWAIT-0001')).not.toBeInTheDocument();
    expect(screen.queryByText('OVER-0001')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Mismatch at Gate'));
    await waitFor(() => expect(screen.getByText('FLAG-0001')).toBeInTheDocument());
    expect(screen.queryByText('AWAIT-0001')).not.toBeInTheDocument();
    expect(screen.queryByText('OVER-0001')).not.toBeInTheDocument();
  });

  it('counts on Awaiting Return only what is expected back TODAY, whenever it was raised', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    // A days-old pass still qualifies — the cut is the RETURN date, not the
    // raise date. The overdue one and the one due in October do not.
    expect(screen.getByRole('link', { name: /Awaiting Return/i })).toHaveTextContent('1');
    expect(itemReturns).not.toHaveBeenCalled();
  });

  it('sweeps every missed return date into Overdue, for all time', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());

    // OVER-0001 is the only pass past its date; the one due today and the one
    // due in October are not in this figure.
    expect(screen.getByRole('link', { name: /^Overdue/i })).toHaveTextContent('1');
  });

  it('marks only Overdue as all-time — Awaiting Return is a today figure now', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('Awaiting Return')).toBeInTheDocument());
    const awaitingCard = screen.getByRole('link', { name: /Awaiting Return/i });
    const overdueCard = screen.getByRole('link', { name: /^Overdue/i });
    expect(overdueCard).toHaveTextContent(/all time/i);
    expect(awaitingCard).not.toHaveTextContent(/all time/i);
  });

  it('does not offer returns on the pending drill — nothing has left yet', async () => {
    renderAt(<GuardDashboard />);
    await waitFor(() => expect(screen.getByText('PEND-0001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /record returns/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /mark returned/i })).not.toBeInTheDocument();
  });
});

describe('Search Pass — the search bar, and nothing else', () => {
  it('no longer renders the KPI cards', async () => {
    renderAt(<GateConsole />);
    await waitFor(() => expect(screen.getByText('Search Pass')).toBeInTheDocument());
    expect(screen.queryByText('Pending for Gate Approval')).not.toBeInTheDocument();
    expect(screen.queryByText('Mismatch at Gate')).not.toBeInTheDocument();
  });

  it('centres the search bar at the top of the page', async () => {
    const { container } = renderAt(<GateConsole />);
    await waitFor(() => expect(screen.getByLabelText('Find a pass by number or mobile')).toBeInTheDocument());
    const lookup = container.querySelector('[data-testid="gate-lookup"]');
    expect(lookup).not.toBeNull();
    expect(lookup?.className).toMatch(/mx-auto/);
    expect(lookup?.className).toMatch(/max-w-/);
  });

  it('no longer renders the Pending Queue at all (client, 2026-08-18)', async () => {
    renderAt(<GateConsole />);
    await waitFor(() => expect(screen.getByText('Search Pass')).toBeInTheDocument());
    expect(screen.queryByText('Pending Queue')).not.toBeInTheDocument();
    expect(screen.queryByText('All Departments')).not.toBeInTheDocument();
    expect(screen.queryByText('All Types')).not.toBeInTheDocument();
    // The queue's passes are not on this page in any other shape either.
    expect(screen.queryByText('PEND-0001')).not.toBeInTheDocument();
  });
});
