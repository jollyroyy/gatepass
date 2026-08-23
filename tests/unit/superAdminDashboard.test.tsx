// THE SUPER ADMIN'S DASHBOARD — the guard's board carrying the admin's figures
// (client, 2026-08-20): `src/pages/Admin/SuperAdminDashboard.tsx`.
//
// FIVE THINGS THIS FILE EXISTS TO PIN:
//
//   1. IT IS DRAWN THE GUARD'S WAY. A greeting (`gb-hello`, never the house
//      `page-title`), on `.gb-board`, with the guard's two `gb-sum` cards and a
//      Quick Actions row of tiles. This is the client's actual instruction, and
//      the thing a future restyle would silently undo.
//   2. IT CARRIES THE ADMIN'S FIVE FIGURES, NOT THE GUARD'S TWO — total, RGP,
//      NRGP, pending approvals, overdue returns — grouped windowed-vs-running.
//   3. THE BOARD INVARIANT SURVIVES THE RESTYLE. Press a figure, count the
//      stack underneath: it is the very array the figure counted. Press it
//      again and it closes. That is the whole reason `superAdminGroups` is
//      forbidden to count anything itself.
//   4. THE TWO RUNNING FIGURES IGNORE THE WINDOW. An obligation does not close
//      because the window rolled past the day it started in, so a pass waiting
//      at the gate since 40 days ago is still counted under a 7-day window.
//   5. ONE QUERY FOR THE FIGURES. `v_gate_passes` and nothing else; the only
//      other read is the emergency-release queue behind the fourth tile.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function daysAgo(back: number): string {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12, 0).toISOString();
}

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'hod-1', raised_by_name: 'P M Sharma',
    visitor_name: 'Alice', visitor_company: null, vehicle_number: null, purpose: null,
    expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: daysAgo(0),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 1, returned_quantity: 0, total_value: 0,
    material_summary: 'Bolts', flagged_at: null, hod_reviewed_at: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

// Three RGP and one NRGP inside the last 7 days; one RGP 20 days back that only
// a wider window takes in; and two old rows that exist to prove the two RUNNING
// figures ignore the window entirely.
const ROWS: GatePassView[] = [
  pass({ id: 'a', pass_number: 'RGP-20260819-0001', created_at: daysAgo(0), visitor_name: 'Alice' }),
  pass({ id: 'b', pass_number: 'RGP-20260817-0002', created_at: daysAgo(2), visitor_name: 'Bob' }),
  pass({ id: 'c', pass_number: 'RGP-20260814-0003', created_at: daysAgo(5), visitor_name: 'Cara' }),
  pass({ id: 'd', pass_number: 'NRGP-20260818-0001', type: 'NRGP', created_at: daysAgo(1), visitor_name: 'Dev' }),
  pass({ id: 'old', pass_number: 'RGP-20260730-0009', created_at: daysAgo(20), visitor_name: 'Omar' }),
  pass({ id: 'wait', pass_number: 'RGP-20260701-0001', created_at: daysAgo(40), status: 'pending', visitor_name: 'Wendy' }),
  pass({
    id: 'late', pass_number: 'RGP-20260701-0002', created_at: daysAgo(40),
    status: 'matched', return_status: 'awaiting_return', is_overdue: true, due_state: 'overdue',
    expected_return_date: new Date(now - 9 * DAY).toISOString().slice(0, 10), visitor_name: 'Lars',
  }),
];

const tables: string[] = [];
const rpcs: string[] = [];

function query(data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'in', 'eq']) obj[m] = () => obj;
  obj.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
    Promise.resolve({ data, error: null }).then(ok, err);
  return obj;
}

// Two emergency releases, ONE of them already reviewed — so the tile's figure
// is 1 and not 2, which is what makes it a queue rather than a total.
const RELEASES = [
  { gate_pass_id: 'r1', pass_number: 'RGP-1', released_by: 'u1', released_name: 'Su', reason: 'x'.repeat(20), released_at: daysAgo(1), reviewed_by: null, reviewed_name: null, reviewed_at: null, review_note: null },
  { gate_pass_id: 'r2', pass_number: 'RGP-2', released_by: 'u1', released_name: 'Su', reason: 'y'.repeat(20), released_at: daysAgo(2), reviewed_by: 'u2', reviewed_name: 'Ad', reviewed_at: daysAgo(1), review_note: 'ok' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) => {
      tables.push(table);
      return query(table === 'v_gate_passes' ? ROWS : []);
    },
    rpc: (name: string) => {
      rpcs.push(name);
      return query(name === 'list_emergency_releases' ? RELEASES : null);
    },
  }),
  pub: () => ({ from: () => query([]) }),
  supabase: { channel: () => ch, removeChannel: () => undefined },
}));

vi.mock('../../src/lib/profiles', () => ({
  fetchMyProfile: () => Promise.resolve({ full_name: 'Sudeshna Pal' }),
}));

import SuperAdminDashboard from '../../src/pages/Admin/SuperAdminDashboard';

async function renderBoard(): Promise<void> {
  tables.length = 0;
  rpcs.length = 0;
  render(
    <MemoryRouter>
      <SuperAdminDashboard />
    </MemoryRouter>,
  );
  await waitFor(() => expect(figure('RGP')).not.toBe('—'));
}

/** The control a named figure is printed on — a button for every figure that
 *  drills in place, and a `<Link>` for Overdue Returns, which opens `/overdue`
 *  instead (client, 2026-08-23). */
function figureButton(label: string): HTMLElement {
  const wrap = screen.getByText(label, { selector: '.gb-figure-label' }).parentElement as HTMLElement;
  return within(wrap).getByRole(label === 'Overdue Returns' ? 'link' : 'button');
}
function figure(label: string): string {
  return figureButton(label).textContent ?? '';
}
function stack(): HTMLElement[] {
  const region = screen.queryByRole('region', { name: 'Selected passes' });
  return region ? Array.from(region.querySelectorAll('a[href^="/pass/"]')) : [];
}

describe('The super admin dashboard is the guard\'s board with the admin\'s figures', () => {
  it('greets by name on the guard skin, and carries no house page title', async () => {
    await renderBoard();
    const hello = screen.getByRole('heading', { name: /^Hello, Sudeshna$/ });
    expect(hello).toHaveClass('gb-hello');
    expect(hello.className).not.toContain('page-title');
    // The guard's white ground, and `gb-main` beside it so the house-themed
    // DrillList underneath takes its light half.
    expect(document.querySelector('.gb-board.gb-main')).toBeTruthy();
    // Both summary cards are the guard's `gb-sum` plate.
    expect(document.querySelectorAll('.gb-sum').length).toBe(2);
  });

  // REWRITTEN 2026-08-22: the admin's Pending Approvals figure became two, one
  // per desk (client), so Needs Attention carries three.
  it('shows the ADMIN’s five figures, grouped windowed against running', async () => {
    await renderBoard();
    // Windowed: 4 raised in the last 7 days (3 RGP + 1 NRGP). The 20-day-old
    // one is outside it.
    expect(screen.queryByText('Total')).toBeNull();
    expect(figure('RGP')).toBe('3');
    expect(figure('NRGP')).toBe('1');
    // Running, and NOT scoped to the window — both rows are 40 days old.
    expect(figure('Pending Gate Review')).toBe('1');
    expect(figure('Pending Approval')).toBe('0');
    expect(figure('Overdue Returns')).toBe('1');
    // The two cards say which is which, so no reader has to guess.
    expect(screen.getByText('Gate Passes Raised')).toBeInTheDocument();
    expect(screen.getByText('Needs Attention')).toBeInTheDocument();
    // REWRITTEN 2026-08-22: it used to also assert a 'Running totals' note
    // rendered under the Needs Attention heading. The client's instruction
    // that day ("remove running and all kinds of subtext from kpi card from
    // all dashboards ... across all views") deleted `SuperGroup.note` and
    // `superAdminGroups` now takes one argument, so neither group prints a
    // note any more — the heading and the figures underneath are the whole
    // card.
    expect(screen.queryByText(/Running totals/)).toBeNull();

    // AND EACH FIGURE IS ON THE RIGHT CARD. Asserting the values alone would
    // not catch a windowed figure being grouped under the running heading —
    // which is exactly the mistake the grouping exists to prevent, since the
    // card's own note would then be false for one of the figures under it.
    const raised = within(screen.getByTestId('super-card-raised'));
    const attention = within(screen.getByTestId('super-card-attention'));
    // TWO FIGURES ON THE RAISED CARD, NOT THREE (client, 2026-08-23): the Total
    // figure came off every dashboard, and the two type figures under it are
    // what it was the sum of.
    expect(raised.getAllByRole('button').map((b) => b.textContent)).toEqual(['3', '1']);
    // TWO BUTTONS AND A LINK on the attention card (client, 2026-08-23):
    // Overdue Returns opens `/overdue` rather than drilling in place.
    expect(attention.getAllByRole('button').map((b) => b.textContent)).toEqual(['1', '0']);
    expect(attention.getAllByRole('link').map((b) => b.textContent)).toEqual(['1']);
    expect(raised.queryByText('Pending Gate Review')).toBeNull();
    expect(attention.getByText('Pending Gate Review')).toBeInTheDocument();
    expect(attention.getByText('Pending Approval')).toBeInTheDocument();
    expect(attention.getByText('Overdue Returns')).toBeInTheDocument();
  });

  it('drills a figure into the very rows it counted, and closes on a second press', async () => {
    await renderBoard();
    expect(stack()).toHaveLength(0);

    fireEvent.click(figureButton('RGP'));
    await waitFor(() => expect(stack()).toHaveLength(3));

    fireEvent.click(figureButton('RGP'));
    await waitFor(() => expect(stack()).toHaveLength(0));
  });

  // REWRITTEN 2026-08-23. It used to press Overdue Returns and assert the one
  // 40-day-old row it counted appeared in the stack. That figure opens
  // `/overdue` now ("once anybody clicks on the overdue card, it should open up
  // the new page"), so the RUNNING scope is pinned on Pending Gate Review — the
  // other figure on the attention card whose row is outside every window — and
  // the destination is pinned here.
  it('drills a RUNNING figure to the one old row it counted, window notwithstanding', async () => {
    await renderBoard();
    fireEvent.click(figureButton('Pending Gate Review'));
    await waitFor(() => expect(stack()).toHaveLength(1));
    expect(screen.getByRole('region', { name: 'Selected passes' }).textContent).toContain('RGP-20260701-0001');
  });

  it('sends Overdue Returns to /overdue rather than opening a stack', async () => {
    await renderBoard();
    const overdue = figureButton('Overdue Returns');
    expect(overdue).toHaveAttribute('href', '/overdue');
    fireEvent.click(overdue);
    expect(stack()).toHaveLength(0);
  });

  it('widening the window changes the windowed figures and leaves the running ones alone', async () => {
    await renderBoard();
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '30' } });
    await waitFor(() => expect(figure('RGP')).toBe('4'));
    expect(figure('RGP')).toBe('4');
    expect(figure('Pending Gate Review')).toBe('1');
    expect(figure('Overdue Returns')).toBe('1');
  });

  it('carries the guard’s Quick Action tiles, four of them, each a route this reader has', async () => {
    await renderBoard();
    expect(screen.getByRole('heading', { name: 'Quick Actions' })).toBeInTheDocument();
    const hrefs = ['/admin', '/all-passes', '/activity'];
    for (const to of hrefs) {
      expect(document.querySelector(`a.gb-tile[href="${to}"]`)).toBeTruthy();
    }
    expect(document.querySelectorAll('a.gb-tile').length).toBe(4);
  });

  it('counts UNREVIEWED emergency releases on the fourth tile, not every release', async () => {
    await renderBoard();
    await waitFor(() => expect(screen.getByText('1 release')).toBeInTheDocument());
    expect(screen.getByText('Emergency Releases')).toBeInTheDocument();
  });

  it('reads v_gate_passes once for the figures, and no aggregate anywhere', async () => {
    await renderBoard();
    expect(tables).toEqual(['v_gate_passes']);
    expect(rpcs).toEqual(['list_emergency_releases']);
  });
});
