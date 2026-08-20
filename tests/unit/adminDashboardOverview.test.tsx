// THE ADMIN DASHBOARD IS THE CLIENT'S "Overview" MOCK-UP (2026-08-19, twelfth
// pass) — `src/pages/Admin/AdminDashboard.tsx`.
//
// FIVE THINGS THIS FILE EXISTS TO PIN:
//
//   1. THE PAGE IS THE MOCK, BOX FOR BOX: a title and a date-range chip, five
//      figures, "Gate Pass Trend", "Passes by Status".
//   2. `GateBoard` IS GONE, and with it the two KPI bands, the Daily Movement
//      Trend, the RGP Status Breakdown, the Return Watch table, Top Items Today,
//      the mismatch attention strip and the department column chart. Deleted
//      rather than flagged off — the client asked for the page to be replaced.
//      A grep would not catch a board quietly rendered again from a copy, so
//      this asserts on what the SCREEN says.
//   3. THE BOARD INVARIANT SURVIVES THE REWRITE. Press a figure, count the
//      stack underneath: it is the very array the figure counted. Press it
//      again and it closes. An arc and a day on the trend drill the same way.
//   4. ONE QUERY. This page reads `v_gate_passes` and nothing else — the old
//      board also read `v_gate_pass_items` for Top Items, which no longer
//      exists. No aggregate, no `count: 'exact'`.
//   5. THE WINDOW GOVERNS THE WHOLE PAGE, and the header chip and the trend
//      card's chip are ONE control bound to ONE piece of state, so they cannot
//      disagree about what is on screen.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
// to prove the two RUNNING figures ignore the window.
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

async function renderBoard(): Promise<void> {
  tables.length = 0;
  render(
    <MemoryRouter>
      <AdminDashboard />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument());
  // The figures render an em dash while loading; wait for the real one.
  await waitFor(() => expect(figure('Total Gate Passes')).not.toBe('—'));
}

/** The number printed on a named card. */
function card(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${label}`) });
}
function figure(label: string): string {
  return within(card(label)).getByText(/^[\d,—]+$/).textContent ?? '';
}
/** The open drill's stacked pass cards. */
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

  it('renders the five figures, in the mock\'s order', async () => {
    await renderBoard();
    const labels = ['Total Gate Passes', 'RGP', 'NRGP', 'Pending Approvals', 'Overdue Returns'];
    for (const l of labels) expect(card(l)).toBeInTheDocument();
    // NRGP, never the mock's "Energy Pay Pass" — the client corrected that
    // phrase on sight the first time it appeared, on the raise form.
    expect(screen.queryByText(/Energy Pay/i)).toBeNull();
  });

  it('counts the window for three figures and ignores it for the two running queues', async () => {
    await renderBoard();
    expect(figure('Total Gate Passes')).toBe('4');
    expect(figure('RGP')).toBe('3');
    expect(figure('NRGP')).toBe('1');
    // Both raised 40 days ago — outside every window, and still counted.
    expect(figure('Pending Approvals')).toBe('1');
    expect(figure('Overdue Returns')).toBe('1');
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

  // The client's foot-of-the-page strip (2026-08-20): "how many are waiting for
  // which person … it's only for today". The board's ONE waiting pass was raised
  // 40 days ago, so the strip reads nothing — which is what proves the day cut,
  // since the Pending Approvals card above it counts that same pass as 1.
  it('carries a Waiting With strip at the foot, scoped to TODAY whatever the window says', async () => {
    await renderBoard();
    const strip = screen.getByRole('heading', { name: 'Waiting With' }).closest('.gb-approvals');
    expect(strip).not.toBeNull();
    for (const desk of ['Security Head', 'COO', 'Finance HOD', 'CEO', 'Security gate']) {
      expect(strip).toHaveTextContent(desk);
    }
    expect(strip).toHaveTextContent('Nothing raised today is waiting — all departments.');
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

describe('every figure drills into the very rows it counted', () => {
  it('opens the stacked list, and pressing the open card closes it', async () => {
    await renderBoard();
    expect(screen.queryByRole('region', { name: 'Selected passes' })).toBeNull();

    fireEvent.click(card('NRGP'));
    await waitFor(() => expect(stack()).toHaveLength(1));
    expect(within(screen.getByRole('region', { name: 'Selected passes' }))
      .getByText('NRGP-20260818-0001')).toBeInTheDocument();
    expect(card('NRGP')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(card('NRGP'));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected passes' })).toBeNull());
  });

  it('lists exactly what each figure printed', async () => {
    await renderBoard();
    for (const label of ['Total Gate Passes', 'RGP', 'Pending Approvals', 'Overdue Returns']) {
      fireEvent.click(card(label));
      const expected = Number(figure(label));
      await waitFor(() => expect(stack()).toHaveLength(expected));
      fireEvent.click(card(label));
      await waitFor(() => expect(screen.queryByRole('region', { name: 'Selected passes' })).toBeNull());
    }
  });

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
    await waitFor(() => expect(figure('Total Gate Passes')).toBe('5'));
  });

  it('names the span in words, so the chip is readable without opening it', async () => {
    await renderBoard();
    expect(screen.getByLabelText('Date range').closest('.gb-ov-range'))
      .toHaveTextContent(/\d+ \w+ – \d+ \w+ \d{4}/);
  });
});
