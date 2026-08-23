// THE ADMIN DASHBOARD IS THE CLIENT'S "Overview" MOCK-UP (2026-08-23, latest
// pass) — `src/pages/Admin/AdminDashboard.tsx`.
//
// FIVE THINGS THIS FILE EXISTS TO PIN:
//
//   1. THE PAGE IS THE MOCK, BOX FOR BOX: a title and a date-range chip, three
//      figures (RGP, NRGP, Overdue Returns), "Gate Pass Trend", "Passes by
//      Status".
//   2. `GateBoard` IS GONE, and with it the two KPI bands, the Daily Movement
//      Trend, the RGP Status Breakdown, the Return Watch table, Top Items Today,
//      the mismatch attention strip and the department column chart. Deleted
//      rather than flagged off — the client asked for the page to be replaced.
//      A grep would not catch a board quietly rendered again from a copy, so
//      this asserts on what the SCREEN says.
//   3. EVERY CARD IS A LINK TO ITS OWN PAGE (client, 2026-08-23: "instead of
//      showing it on the same page in the dashboard, show it on a new page for
//      all the KPI cards"). RGP and NRGP link to `/admin-dashboard/<key>
//      ?days=N`; Overdue Returns links to `/overdue`. Nothing reveals a stack
//      under a card any more — `/admin-dashboard/:key` (`DashboardDrill`)
//      rebuilds the same row and renders the very array the pressed figure
//      counted. The trend bars and the status ring's arcs still drill IN PLACE
//      — they are not KPI cards.
//   4. THE TWO PENDING DESKS ARE GONE AS CARDS (client, 2026-08-23: "instead of
//      making it as a separate pending card, make the similar type of pending
//      gate approval and pending approval under each NRGP and RGP … remove all
//      those two pending cards completely"). They are now two RUNNING desk
//      lines under each pass-type card (`.gb-kpi-note`), scoped to that type.
//   5. ONE QUERY. This page reads `v_gate_passes` and `pass_approvals` (for the
//      Waiting With strip) and nothing else — no `v_gate_pass_items`, no
//      aggregate, no `count: 'exact'`.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

/** Noon, `back` local days ago — the middle of the day, never a timezone edge. */
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

// Three RGP and one NRGP inside the last 7 days; one RGP raised 20 days ago,
// which only a wider window may take in; one pass waiting at the gate and one
// still out and late, both old enough that no window contains them — they exist
// to prove the two RUNNING desk lines (and Overdue Returns) ignore the window.
const ROWS: GatePassView[] = [
  pass({ id: 'a', pass_number: 'RGP-20260819-0001', created_at: daysAgo(0), visitor_name: 'Alice' }),
  pass({ id: 'b', pass_number: 'RGP-20260817-0002', created_at: daysAgo(2), visitor_name: 'Bob' }),
  pass({ id: 'c', pass_number: 'RGP-20260814-0003', created_at: daysAgo(5), visitor_name: 'Cara' }),
  pass({
    id: 'd', pass_number: 'NRGP-20260818-0001', type: 'NRGP',
    created_at: daysAgo(1), visitor_name: 'Dev', material_summary: 'Scrap',
  }),
  pass({ id: 'old', pass_number: 'RGP-20260730-0009', created_at: daysAgo(20), visitor_name: 'Omar' }),
  pass({
    id: 'wait', pass_number: 'RGP-20260701-0001', created_at: daysAgo(40),
    status: 'pending', visitor_name: 'Wendy',
  }),
  pass({
    id: 'late', pass_number: 'RGP-20260701-0002', created_at: daysAgo(40),
    status: 'matched', return_status: 'awaiting_return', is_overdue: true, due_state: 'overdue',
    expected_return_date: new Date(now - 9 * DAY).toISOString().slice(0, 10), visitor_name: 'Lars',
  }),
];

const tables: string[] = [];

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
      tables.push(table);
      return query(table === 'v_gate_passes' ? ROWS : []);
    },
    rpc: () => query(null),
  }),
  pub: () => ({ from: () => query([]) }),
  supabase: { channel: () => ch, removeChannel: () => undefined },
}));

import AdminDashboard from '../../src/pages/Admin/AdminDashboard';
import DashboardDrill from '../../src/pages/Admin/DashboardDrill';

async function renderBoard(): Promise<void> {
  tables.length = 0;
  render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument());
  // The figures render an em dash while loading; wait for the real one.
  await waitFor(() => expect(figure('RGP')).not.toBe('—'));
}

/** A figure's card. Every card is a `<Link>` since 2026-08-23 — none of the
 *  three drills in place any more. */
function card(label: string): HTMLElement {
  return screen.getByRole('link', { name: new RegExp(`^${label}`) });
}
function figure(label: string): string {
  return within(card(label)).getByText(/^[\d,—]+$/, { selector: '.gb-ov-figure' }).textContent ?? '';
}
/** The value on one of a pass-type card's two running desk lines. */
function note(cardLabel: string, noteLabel: string): string {
  const labelEl = within(card(cardLabel)).getByText(noteLabel, { selector: '.gb-kpi-note-label' });
  const wrap = labelEl.closest('.gb-kpi-note') as HTMLElement;
  return within(wrap).getByText(/^[\d,—]+$/, { selector: '.gb-kpi-note-value' }).textContent ?? '';
}
/** The open drill's stacked pass cards — still used by the trend and the ring,
 *  which drill IN PLACE (they are not KPI cards). */
function stack(): HTMLElement[] {
  const region = screen.getByRole('region', { name: 'Selected passes' });
  return within(region).getAllByTestId('pass-stack-card');
}

describe('the admin dashboard is the Overview mock-up', () => {
  it('draws the title, the date-range chip and the mock\'s two panels', async () => {
    await renderBoard();
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByLabelText('Date range')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Gate Pass Trend' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Passes by Status' })).toBeInTheDocument();
  });

  // REWRITTEN 2026-08-23: the two pending-desk cards came off entirely (client:
  // "remove all those two pending cards completely"), folded into a pair of
  // running desk lines under each of RGP and NRGP; Total Gate Passes had
  // already come off. Three cards remain.
  it('renders the three figures, in the mock order', async () => {
    await renderBoard();
    const labels = ['RGP', 'NRGP', 'Overdue Returns'];
    for (const l of labels) expect(card(l)).toBeInTheDocument();
    expect(screen.queryByText('Total Gate Passes')).toBeNull();
    expect(screen.queryByRole('link', { name: /^Pending Gate Review/ })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Pending Approval/ })).toBeNull();
    // NRGP, never the mock's "Energy Pay Pass" — the client corrected that
    // phrase on sight the first time it appeared, on the raise form.
    expect(screen.queryByText(/Energy Pay/i)).toBeNull();
  });

  it('counts the window for the two type figures, and Overdue Returns runs unwindowed', async () => {
    await renderBoard();
    expect(figure('RGP')).toBe('3');
    expect(figure('NRGP')).toBe('1');
    expect(figure('Overdue Returns')).toBe('1');
  });

  // The two desk lines under a pass-type card are RUNNING (never scoped by the
  // window) and scoped to that ONE type — the waiting RGP ("wait", 40 days old)
  // counts under RGP only; the NRGP card's own lines are both zero.
  it('prints the two running desk lines under each pass-type card, scoped to that type', async () => {
    await renderBoard();
    expect(note('RGP', 'Pending gate approval')).toBe('1');
    expect(note('RGP', 'Pending approval')).toBe('0');
    expect(note('NRGP', 'Pending gate approval')).toBe('0');
    expect(note('NRGP', 'Pending approval')).toBe('0');
    // Overdue Returns carries no desk lines — it is the running queue itself.
    expect(within(card('Overdue Returns')).queryByText('Pending gate approval')).toBeNull();
  });

  it('renders NONE of the old GateBoard — it was replaced, not hidden', async () => {
    await renderBoard();
    for (const gone of [
      'RGP Overview', 'NRGP Overview', 'Daily Movement Trend', 'RGP Status Breakdown',
      'RGP Return Watch', 'Top Items Today', 'Passes by Department',
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  // REWRITTEN 2026-08-21. It used to hold the opposite: that the strip was cut
  // to TODAY, and that this board's one waiting pass — raised 40 days ago — was
  // therefore absent from it. The client removed that cut ("it should not be
  // only the passes which were raised today, but all the passes which are
  // pending for all those approvals accordingly … remove the today word from
  // the bottom from the admin view"), so the strip now agrees with the running
  // desk lines under the cards above it, which count that same pass as 1.
  it('carries a Waiting With strip at the foot, counting every pending pass whatever the window says', async () => {
    await renderBoard();
    const strip = screen.getByRole('heading', { name: 'Waiting With' }).closest('.gb-approvals');
    expect(strip).not.toBeNull();
    for (const desk of ['Security Head', 'COO', 'Finance HOD', 'CEO', 'Security gate']) {
      expect(strip).toHaveTextContent(desk);
    }
    // The 40-day-old pass IS counted now, and nothing on the strip says "today".
    expect(strip).toHaveTextContent('1 pass waiting on these desks — all departments.');
    expect(strip?.textContent).not.toMatch(/today/i);
    // A reading, not a drill — no control of any kind lives on it.
    expect(within(strip as HTMLElement).queryByRole('button')).toBeNull();
    expect(within(strip as HTMLElement).queryByRole('link')).toBeNull();
  });

  // REWRITTEN 2026-08-20. It used to hold that this board read `v_gate_passes`
  // and NOTHING else — the `v_gate_pass_items` read went with Top Items when the
  // Overview mock-up replaced GateBoard. That half is unchanged and still
  // pinned. What changed is the client's "Waiting With" strip at the foot of the
  // page, which needs the ladder rows for today's passes; it is a second table,
  // narrowed to the ids the FIRST read already returned, never an aggregate.
  it('reads v_gate_passes and pass_approvals — and never the item table', async () => {
    await renderBoard();
    expect([...new Set(tables)].sort()).toEqual(['pass_approvals', 'v_gate_passes']);
    expect(tables).not.toContain('v_gate_pass_items');
  });
});

// REWRITTEN 2026-08-23. Every KPI card used to reveal a stack of pass cards
// under itself in place; the client asked that each one open its own page
// instead ("instead of showing it on the same page in the dashboard, show it
// on a new page for all the KPI cards"). The trend bars and the status ring's
// arcs are unaffected — they are not KPI cards, and still drill in place below.
describe('every KPI card links to its own drill page instead of opening in place', () => {
  it('carries the window on its href for RGP and NRGP, and no board region opens on click', async () => {
    await renderBoard();
    expect(card('RGP')).toHaveAttribute('href', '/admin-dashboard/rgp?days=7');
    expect(card('NRGP')).toHaveAttribute('href', '/admin-dashboard/nrgp?days=7');
    fireEvent.click(card('NRGP'));
    expect(screen.queryByRole('region', { name: 'Selected passes' })).toBeNull();
  });

  it('sends Overdue Returns to /overdue, unwindowed', async () => {
    await renderBoard();
    const overdue = card('Overdue Returns');
    expect(overdue).toHaveAttribute('href', '/overdue');
    fireEvent.click(overdue);
    expect(screen.queryByRole('region', { name: 'Selected passes' })).toBeNull();
  });

  // `DashboardDrill` is what a card's href actually opens: it re-reads
  // `v_gate_passes` itself and rebuilds the very row the card counted, so the
  // rows listed here are the rows RGP printed above, not a second predicate.
  it('/admin-dashboard/rgp?days=7 lists exactly the rows the RGP card counted', async () => {
    render(
      <MemoryRouter initialEntries={['/admin-dashboard/rgp?days=7']}>
        <Routes>
          <Route path="/admin-dashboard/:key" element={<DashboardDrill />} />
          <Route path="/admin-dashboard" element={<div>back on the board</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('3 passes')).toBeInTheDocument());
    const cards = screen.getAllByTestId('pass-stack-card');
    expect(cards).toHaveLength(3);
    expect(screen.getByText('RGP-20260819-0001')).toBeInTheDocument();
    expect(screen.getByText('RGP-20260817-0002')).toBeInTheDocument();
    expect(screen.getByText('RGP-20260814-0003')).toBeInTheDocument();
    // "Omar"'s pass is 20 days old — outside the 7-day window this URL asked
    // for — so it is not on this page either.
    expect(screen.queryByText('RGP-20260730-0009')).toBeNull();
    expect(screen.getByText('Back to dashboard')).toHaveAttribute('href', '/admin-dashboard');
  });

  it('sends an unknown :key back to the dashboard rather than rendering a dead page', async () => {
    render(
      <MemoryRouter initialEntries={['/admin-dashboard/bogus?days=7']}>
        <Routes>
          <Route path="/admin-dashboard/:key" element={<DashboardDrill />} />
          <Route path="/admin-dashboard" element={<div>back on the board</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('back on the board')).toBeInTheDocument());
  });
});

describe('the trend and the status ring still drill in place', () => {
  it('drills a status arc from the ring\'s legend', async () => {
    await renderBoard();
    // Four passes in the window, all `matched` with no return leg: one arc.
    fireEvent.click(screen.getByRole('button', { name: /^Approved: 4 passes/ }));
    await waitFor(() => expect(stack()).toHaveLength(4));
  });

  it('offers no button on an empty arc — it would open a dead end', async () => {
    await renderBoard();
    expect(screen.queryByRole('button', { name: /^Rejected:/ })).toBeNull();
    // …but the bucket is still LISTED, so the legend means the same thing every
    // week. Five fixed states, plus the Total row the mock draws.
    const legend = screen.getByRole('img', { name: /Passes by status/ }).closest('.gb-ov-status');
    expect(within(legend as HTMLElement).getByText('Rejected')).toBeInTheDocument();
  });

  it('drills one day off the trend', async () => {
    await renderBoard();
    // Today carries exactly one raise; every other day in the window is empty,
    // so this label is unique — and a day that plotted nothing still draws its
    // hit strip, which is what stops the reader hunting for a missing target.
    const today = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' }).format(new Date(now));
    fireEvent.click(screen.getByRole('button', { name: `${today}: 1 pass raised` }));
    await waitFor(() => expect(stack()).toHaveLength(1));
  });
});

describe('the window control', () => {
  it('is ONE choice: the header chip and the trend card move together', async () => {
    await renderBoard();
    const header = screen.getByLabelText('Date range') as HTMLSelectElement;
    const panel = screen.getByLabelText('Trend window') as HTMLSelectElement;
    expect(header.value).toBe('7');
    expect(panel.value).toBe('7');

    fireEvent.change(panel, { target: { value: '30' } });
    await waitFor(() => expect(header.value).toBe('30'));
    // The 20-day-old pass is inside a 30-day window and was outside a 7-day one.
    await waitFor(() => expect(figure('RGP')).toBe('4'));
    // The window rides into the card's own href too.
    expect(card('RGP')).toHaveAttribute('href', '/admin-dashboard/rgp?days=30');
  });

  it('names the span in words, so the chip is readable without opening it', async () => {
    await renderBoard();
    expect(screen.getByLabelText('Date range').closest('.gb-ov-range'))
      .toHaveTextContent(/\d+ \w+ – \d+ \w+ \d{4}/);
  });
});
