// THE SUPER ADMIN'S DASHBOARD — the guard's board carrying the admin's figures
// (client, 2026-08-20): `src/pages/Admin/SuperAdminDashboard.tsx`.
//
// FIVE THINGS THIS FILE EXISTS TO PIN:
//
//   1. IT IS DRAWN THE GUARD'S WAY. A greeting (`gb-hello`, never the house
//      `page-title`), on `.gb-board`, with the guard's two `gb-sum` cards and a
//      Quick Actions row of tiles. This is the client's actual instruction, and
//      the thing a future restyle would silently undo.
//   2. IT CARRIES THREE OF THE ADMIN'S FIGURES, NOT FIVE — RGP, NRGP and
//      Overdue Returns, grouped windowed-vs-running. Total Gate Passes and the
//      two separate pending-desk cards are gone (client, 2026-08-23); the two
//      desks now print as running lines UNDER the RGP and NRGP figures instead.
//   3. EVERY FIGURE IS A LINK TO ITS OWN PAGE, NOT A DRILL IN PLACE (client,
//      2026-08-23: "show it on a new page for all the KPI cards"). RGP and
//      NRGP link to `/admin-dashboard/<key>?days=N` — the very page
//      `AdminDashboard`'s own cards open, rebuilt from the same
//      `buildOverviewCards`; Overdue Returns links to `/overdue`. Nothing
//      reveals a stack under a card any more, and `superAdminGroups` is still
//      forbidden to count anything itself.
//   4. THE RUNNING FIGURES AND DESK LINES IGNORE THE WINDOW. An obligation does
//      not close because the window rolled past the day it started in, so a
//      pass waiting at the gate since 40 days ago is still counted under a
//      7-day window.
//   5. ONE QUERY FOR THE FIGURES. `v_gate_passes` and nothing else; the only
//      other read is the emergency-release queue behind the fourth tile.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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
import DashboardDrill from '../../src/pages/Admin/DashboardDrill';

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

/** The `<Link>` a named figure is printed on — every figure navigates since
 *  2026-08-23, RGP/NRGP to `/admin-dashboard/<key>?days=N`, Overdue Returns to
 *  `/overdue`. */
function figureButton(label: string): HTMLElement {
  const wrap = screen.getByText(label, { selector: '.gb-figure-label' }).parentElement as HTMLElement;
  return within(wrap).getByRole('link');
}
function figure(label: string): string {
  return figureButton(label).textContent ?? '';
}
/** The value on one of a pass-type figure's two running desk lines. Each
 *  `.gb-figure-note` reads as "1Pending gate approval" (value then label, no
 *  separating text node), so it is found by substring rather than an exact
 *  `getByText` match. */
function note(figureLabel: string, noteLabel: string): string {
  const wrap = screen.getByText(figureLabel, { selector: '.gb-figure-label' }).parentElement as HTMLElement;
  const notes = within(wrap).getAllByText(/./, { selector: '.gb-figure-note' });
  const noteEl = notes.find((el) => el.textContent?.includes(noteLabel));
  if (!noteEl) throw new Error(`no "${noteLabel}" desk line under ${figureLabel}`);
  return within(noteEl).getByText(/^[\d,—]+$/, { selector: '.gb-figure-note-value' }).textContent ?? '';
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

  // REWRITTEN 2026-08-23: Total Gate Passes came off every dashboard, and the
  // two separate pending-desk cards became running lines under RGP and NRGP —
  // so this board carries three figures across its two cards, not five.
  it('shows THREE of the admin\'s figures, grouped windowed against running', async () => {
    await renderBoard();
    // Windowed: 4 raised in the last 7 days (3 RGP + 1 NRGP). The 20-day-old
    // one is outside it.
    expect(screen.queryByText('Total')).toBeNull();
    expect(figure('RGP')).toBe('3');
    expect(figure('NRGP')).toBe('1');
    // Running, and NOT scoped to the window — the waiting pass is 40 days old.
    expect(figure('Overdue Returns')).toBe('1');
    // The two cards say which is which, so no reader has to guess.
    expect(screen.getByText('Gate Passes Raised')).toBeInTheDocument();
    expect(screen.getByText('Needs Attention')).toBeInTheDocument();
    // The client's instruction that day ("remove running and all kinds of
    // subtext from kpi card from all dashboards ... across all views") deleted
    // `SuperGroup.note`, and `superAdminGroups` takes one argument, so neither
    // group heading prints a note any more.
    expect(screen.queryByText(/Running totals/)).toBeNull();

    // AND EACH FIGURE IS ON THE RIGHT CARD. Asserting the values alone would
    // not catch a windowed figure being grouped under the running heading —
    // which is exactly the mistake the grouping exists to prevent.
    const raised = within(screen.getByTestId('super-card-raised'));
    const attention = within(screen.getByTestId('super-card-attention'));
    // TWO FIGURES ON THE RAISED CARD (client, 2026-08-23): the Total figure
    // came off every dashboard, and the two type figures under it are what it
    // was the sum of.
    expect(raised.getAllByRole('link').map((b) => b.textContent)).toEqual(['3', '1']);
    // ONE FIGURE ON THE ATTENTION CARD NOW (client, 2026-08-23): the two
    // pending-desk figures came off it entirely, leaving Overdue Returns alone.
    expect(attention.getAllByRole('link').map((b) => b.textContent)).toEqual(['1']);
    expect(attention.getByText('Overdue Returns')).toBeInTheDocument();
    expect(attention.queryByText('Pending Gate Review')).toBeNull();
    expect(attention.queryByText('Pending Approval')).toBeNull();
  });

  // The two desks that used to be their own cards are now RUNNING lines under
  // RGP and NRGP, scoped to that ONE type — the waiting RGP ("wait", 40 days
  // old) counts under RGP only; NRGP's own lines are both zero.
  it('prints the two running desk lines under RGP and NRGP, scoped to that type', async () => {
    await renderBoard();
    expect(note('RGP', 'Pending gate approval')).toBe('1');
    expect(note('RGP', 'Pending approval')).toBe('0');
    expect(note('NRGP', 'Pending gate approval')).toBe('0');
    expect(note('NRGP', 'Pending approval')).toBe('0');
  });

  it('carries the window on the RGP and NRGP links, and opens nothing in place on click', async () => {
    await renderBoard();
    expect(figureButton('RGP')).toHaveAttribute('href', '/admin-dashboard/rgp?days=7');
    expect(figureButton('NRGP')).toHaveAttribute('href', '/admin-dashboard/nrgp?days=7');
    fireEvent.click(figureButton('RGP'));
    expect(screen.queryByRole('region', { name: 'Selected passes' })).toBeNull();
  });

  // The href a super admin's RGP figure carries opens the very page the admin
  // Overview's own RGP card opens — same key, same window, same rows.
  it('/admin-dashboard/rgp?days=7 lists exactly the rows the RGP figure counted', async () => {
    render(
      <MemoryRouter initialEntries={['/admin-dashboard/rgp?days=7']}>
        <Routes>
          <Route path="/admin-dashboard/:key" element={<DashboardDrill />} />
          <Route path="/admin-dashboard" element={<div>back on the board</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('3 passes')).toBeInTheDocument());
    expect(screen.getAllByTestId('pass-stack-card')).toHaveLength(3);
  });

  it('sends Overdue Returns to /overdue rather than opening a stack', async () => {
    await renderBoard();
    const overdue = figureButton('Overdue Returns');
    expect(overdue).toHaveAttribute('href', '/overdue');
    fireEvent.click(overdue);
    expect(screen.queryByRole('region', { name: 'Selected passes' })).toBeNull();
  });

  it('widening the window changes the windowed figures and leaves the running ones alone', async () => {
    await renderBoard();
    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '30' } });
    await waitFor(() => expect(figure('RGP')).toBe('4'));
    expect(figure('RGP')).toBe('4');
    expect(figure('Overdue Returns')).toBe('1');
    expect(note('RGP', 'Pending gate approval')).toBe('1');
    // And the window rides into the widened href too.
    expect(figureButton('RGP')).toHaveAttribute('href', '/admin-dashboard/rgp?days=30');
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
