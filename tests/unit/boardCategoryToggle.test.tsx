// The dashboard category toggle — RGP Out / RGP In / NRGP Out.
//
// Client's call, 2026-08-17: "can I do one thing for each and every admin — is
// it possible to toggle between RGP Out and NRGP Out? When I'm selecting RGP
// Out it would show how many are there in total, how many are pending at the
// gate, how many are overdue. Similarly if we toggle it to the other one it
// would show the same thing. Instead of showing it on the same page, I want a
// toggle so that it will be much more clear. On the top right corner keep the
// same filter — today, last one week, last one month — I just put the toggle
// and keep all the KPI buttons and all the pie charts accordingly."
//
// WHAT THIS FILE PINS, and why each half could break quietly:
//
//   1. THE TOGGLE NARROWS THE COUNT, NOT THE LIST. A filter applied only where
//      the rows are rendered leaves the KPI cards reading the org-wide figure
//      while the drill under them shows three passes — the exact "chart
//      disagrees with its own list" failure the board's invariant exists to
//      prevent. Every assertion below reads a printed figure, clicks it, and
//      counts the list.
//   2. IT APPLIES TO EVERY PANEL, including the two that are deliberately NOT
//      period-scoped (the all-time Overdue panel and the trend line). Those are
//      exempt from the PERIOD filter for reasons of their own; nothing makes
//      them exempt from a CATEGORY filter, and a "RGP Out" board listing an
//      NRGP is simply wrong.
//   3. BOTH BOARDS GET IT. Admin and HOD render the same components, so a
//      change made in one place is easy to believe reaches both. It has to be
//      wired at each page, because each owns its own `rows`.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const ME = 'hod-1';

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

// Six passes today, one older, spread across all three legal categories so a
// toggle that silently does nothing cannot pass:
//
//   RGP Out  — Alice (pending) · Bob (out) · Carol (out, overdue)   = 3
//   RGP In   — Dan (pending)                                        = 1
//   NRGP Out — Eve (pending) · Fay (cleared)                        = 2
//   plus Gus — RGP Out, five days old, overdue (all-time panel only)
const ROWS: GatePassView[] = [
  pass({ id: 't1', visitor_name: 'Alice', created_at: TODAY, status: 'pending' }),
  pass({ id: 't2', visitor_name: 'Bob', created_at: TODAY, status: 'matched', return_status: 'awaiting_return' }),
  pass({
    id: 't3', visitor_name: 'Carol', created_at: TODAY, status: 'matched',
    return_status: 'partially_returned', is_overdue: true, expected_return_date: FIVE_DAYS_AGO,
  }),
  pass({
    id: 't4', visitor_name: 'Dan', created_at: TODAY, direction: 'in', status: 'pending',
    pass_number: 'RGP-IN-20260817-0001',
  }),
  pass({
    id: 't5', visitor_name: 'Eve', created_at: TODAY, type: 'NRGP', status: 'pending',
    pass_number: 'NRGP-OUT-20260817-0001',
  }),
  pass({
    id: 't6', visitor_name: 'Fay', created_at: TODAY, type: 'NRGP', status: 'matched',
    pass_number: 'NRGP-OUT-20260817-0002',
  }),
  pass({
    id: 'o1', visitor_name: 'Gus', created_at: FIVE_DAYS_AGO, status: 'matched',
    return_status: 'awaiting_return', is_overdue: true, expected_return_date: FIVE_DAYS_AGO,
  }),
];

const ITEMS = [
  { id: 'i1', gate_pass_id: 't1', name: 'Ladder', quantity: 2 },
  { id: 'i2', gate_pass_id: 't5', name: 'Scrap Steel', quantity: 1 },
];

function query(data: unknown) {
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
      if (table === 'v_gate_passes') return query(ROWS);
      if (table === 'v_gate_pass_items') return query(ITEMS);
      return query([{ department_id: 'd1' }]);
    },
  }),
  pub: () => ({ from: () => query([{ id: 'd1', name: 'Engineering' }]) }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: ME } }, error: null }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import AdminDashboard from '../../src/pages/Admin/AdminDashboard';
import HodDashboard from '../../src/pages/HOD/Dashboard';

/** Scoped to the headline row on purpose: once the board is narrowed the
 *  overview donut falls back to status mode, whose slices are labelled with the
 *  same words ("Cleared at Gate", "Pending"). An unscoped lookup would find the
 *  slice and pass for the wrong reason — or, as here, find both and throw. */
function kpi(label: string): HTMLElement {
  return within(screen.getByRole('group', { name: 'Headline figures' })).getByRole('button', {
    name: new RegExp(`^${label}`),
  });
}

function drill(): HTMLElement {
  return screen.getByRole('region', { name: 'Selected passes' });
}

function categoryToggle(): HTMLElement {
  return screen.getByRole('group', { name: 'Pass category' });
}

function pick(label: string) {
  fireEvent.click(within(categoryToggle()).getByRole('button', { name: label }));
}

async function renderBoard(which: 'admin' | 'hod') {
  const Board = which === 'admin' ? AdminDashboard : HodDashboard;
  render(
    <MemoryRouter>
      <Board />
    </MemoryRouter>,
  );
  await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('6'));
}

describe.each(['admin', 'hod'] as const)('%s board — the category toggle', (which) => {
  it('offers All and the three legal categories, with All selected by default', async () => {
    await renderBoard(which);
    const group = categoryToggle();
    for (const label of ['All', 'RGP Out', 'RGP In', 'NRGP Out']) {
      expect(within(group).getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(within(group).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    // There is deliberately no NRGP In — permanently inbound material is a
    // goods receipt, not a gate pass (`gate_passes_nrgp_is_outward`).
    expect(within(group).queryByRole('button', { name: 'NRGP In' })).not.toBeInTheDocument();
  });

  it('keeps the period filter alongside it, unchanged', async () => {
    await renderBoard(which);
    expect(screen.getByRole('group', { name: 'Dashboard period' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('narrows every headline KPI to RGP Out', async () => {
    await renderBoard(which);
    pick('RGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('3'));
    expect(kpi('Pending Approvals')).toHaveTextContent('1');
    expect(kpi('Cleared at Gate')).toHaveTextContent('2');
    expect(kpi('Materials Outside')).toHaveTextContent('2');
    expect(kpi('Overdue Returns')).toHaveTextContent('1');
  });

  it('narrows every headline KPI to NRGP Out', async () => {
    await renderBoard(which);
    pick('NRGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('2'));
    expect(kpi('Pending Approvals')).toHaveTextContent('1');
    expect(kpi('Cleared at Gate')).toHaveTextContent('1');
    // An NRGP never comes back — `gate_passes_return_status_rgp_only` pins it to
    // not_applicable — so both return figures must be zero, not inherited.
    expect(kpi('Materials Outside')).toHaveTextContent('0');
    expect(kpi('Overdue Returns')).toHaveTextContent('0');
  });

  it('narrows to RGP In, the category that only Bulk Create can produce', async () => {
    await renderBoard(which);
    pick('RGP In');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('1'));
    expect(kpi('Pending Approvals')).toHaveTextContent('1');
  });

  it('opens a drill holding exactly the narrowed rows, and no other category', async () => {
    await renderBoard(which);
    pick('NRGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('2'));

    fireEvent.click(kpi('Passes Raised'));
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
    expect(within(drill()).getByText('Eve')).toBeInTheDocument();
    expect(within(drill()).getByText('Fay')).toBeInTheDocument();
    expect(within(drill()).queryByText('Alice')).not.toBeInTheDocument();
    expect(within(drill()).queryByText('Dan')).not.toBeInTheDocument();
  });

  it('returns to the full board when All is picked again', async () => {
    await renderBoard(which);
    pick('RGP In');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('1'));
    pick('All');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('6'));
    expect(kpi('Pending Approvals')).toHaveTextContent('3');
  });

  it('drops the donut\'s "By category" mode once one category is chosen', async () => {
    await renderBoard(which);
    // Both modes are on offer while the board shows everything.
    expect(screen.getByLabelText('Gate Pass Overview breakdown')).toBeInTheDocument();

    pick('RGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('3'));
    // A category donut of a single category is one ring at 100% naming the
    // toggle the reader just pressed. The card falls back to status.
    expect(screen.queryByLabelText('Gate Pass Overview breakdown')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Pending: 1 pass/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Cleared at Gate: 2 passes/ })).toBeInTheDocument();
  });

  it('narrows the all-time Overdue panel too, which the period filter does not', async () => {
    await renderBoard(which);
    // All time and all categories: Carol and Gus, both RGP Out.
    fireEvent.click(screen.getByRole('button', { name: 'View All' }));
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();

    pick('NRGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('button', { name: 'View All' }));
    expect(within(drill()).getByText('Nothing is overdue.')).toBeInTheDocument();
  });

  it('narrows the trend line, which carries its own window', async () => {
    await renderBoard(which);
    pick('NRGP Out');
    await waitFor(() => expect(kpi('Passes Raised')).toHaveTextContent('2'));

    // Today's bucket on the 7-day line: the two NRGPs only. Scoped to the card,
    // because ": 2 passes" is also how a donut slice labels itself.
    const trend = screen.getByRole('heading', { name: 'Passes Trend' }).closest('section') as HTMLElement;
    fireEvent.click(within(trend).getByRole('button', { name: /: 2 passes$/ }));
    expect(within(drill()).getByText('2 passes')).toBeInTheDocument();
    expect(within(drill()).queryByText('Alice')).not.toBeInTheDocument();
  });
});
