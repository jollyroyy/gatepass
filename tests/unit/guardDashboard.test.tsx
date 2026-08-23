// The guard's board after the 2026-08-19 second revision: a greeting, two
// DRILLABLE figures, and three quick actions. Nothing else.
//
// What these cases exist to hold:
//   * The RGP/NRGP split of Pending OUT sums to the whole gate queue, and the
//     return figure counts DUE-TODAY material only — not the backlog and not
//     the future. A pass past its date is counted by Overdue Returns and by
//     nothing else (client, 2026-08-23), and an October date is on neither
//     page because neither would take its return today.
//   * EVERY FIGURE DRILLS, AND SINCE 2026-08-23 ITS LIST IS A PAGE (client:
//     "don't show the table on the same page. Show it on a different page,
//     like you are showing the overdue details"). The figures drilled in place
//     for a day; before that, and again now, each is a `<Link>` — RGP and NRGP
//     to `/guard-dashboard/RGP` / `/guard-dashboard/NRGP`, the return figure to
//     `/guard-dashboard/returns`. `GuardDashboard` itself renders neither panel
//     any more; `GuardDrill` (tested in `pendingOutDrill.test.tsx` and
//     `pendingReturnsDrill.test.tsx`) is what a figure opens.
//   * NOTHING IS LISTED ON THIS PAGE, PRESSED OR NOT. The two five-row previews
//     that used to sit under the cards were deleted on 2026-08-19 and have not
//     come back, and the in-place drill that briefly replaced them is also
//     gone: this page shows figures and quick actions only.
//   * Nothing from the old seven-drill board survives — no KPI drill, no pass
//     cards, no "Today's Summary".
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ALL_LINKS } from '../../src/components/layout/Sidebar';
import { ROLE_ROUTES } from '../../src/lib/roleRoutes';
import type { GatePassItemView, GatePassView } from '../../src/types';

const FUTURE = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

// r1 is the pass that is due back TODAY, and the Overdue Returns tile counts
// lines whose date has already passed. A hardcoded date makes the second of
// those figures change by itself the next morning — which it did, on
// 2026-08-20, with a fixture written on the 19th. Local calendar day, because
// that is the cut `buildOverdueRows` makes.
const TODAY = (() => {
  const d = new Date();
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
})();

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: FUTURE, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'r1', line_no: 1, name: 'Scaffolding Pipe', quantity: 100,
    unit: 'nos', returned_qty: 0, outstanding_qty: 100, expected_return_date: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// The gate queue — one RGP and two NRGP, so the card's two figures are
// distinguishable from each other and from the list length.
let QUEUE: GatePassView[] = [];
// Everything still out, of any date. The board cuts it to what is due.
let OPEN_RETURNS: GatePassView[] = [];
// The LINES of those passes — what the two Quick Action figures count, because
// /returns and /overdue are both line-level tables.
let OPEN_ITEMS: GatePassItemView[] = [];

function resetRows(): void {
  QUEUE = [
    pass({ id: 'q1', pass_number: 'RGP-20260819-0057', type: 'RGP',
           visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}' }),
    pass({ id: 'q2', pass_number: 'NRGP-20260819-0081', type: 'NRGP', direction: 'out',
           material_summary: 'Cement Bags', total_quantity: 500 }),
    pass({ id: 'q3', pass_number: 'NRGP-20260819-0080', type: 'NRGP', direction: 'out',
           material_summary: 'Bricks', total_quantity: 10000 }),
  ];
  OPEN_RETURNS = [
    pass({ id: 'r1', pass_number: 'RGP-20260518-0056', status: 'matched',
           return_status: 'awaiting_return', expected_return_date: TODAY,
           due_state: 'due_today', material_summary: 'Scaffolding Pipes',
           total_quantity: 200, returned_quantity: 0 }),
    pass({ id: 'r2', pass_number: 'RGP-20260517-0055', status: 'partially_returned',
           return_status: 'partially_returned', expected_return_date: '2026-05-18',
           due_state: 'overdue', is_overdue: true, material_summary: 'Timber Planks',
           total_quantity: 150, returned_quantity: 50 }),
    // Due in October: a real obligation, deliberately counted by neither figure.
    pass({ id: 'r3', pass_number: 'RGP-20261001-0099', status: 'matched',
           return_status: 'awaiting_return', expected_return_date: '2026-10-01',
           material_summary: 'Wall Putty', due_state: 'ok' }),
  ];
  OPEN_ITEMS = [
    // r1 is due TODAY: two lines, so the tile must read 2 and not 1 (a pass
    // count beside a line list is exactly the drift the invariant forbids).
    item({ id: 'i1', gate_pass_id: 'r1', line_no: 1 }),
    item({ id: 'i2', gate_pass_id: 'r1', line_no: 2, name: 'Base Plate' }),
    // r2 went overdue in May. One line still owes material, one is fully back.
    item({ id: 'i3', gate_pass_id: 'r2', line_no: 1, name: 'Timber Plank' }),
    item({ id: 'i4', gate_pass_id: 'r2', line_no: 2, name: 'Nail Box',
           returned_qty: 100, outstanding_qty: 0 }),
    // r3 is due in October — outstanding, but not late.
    item({ id: 'i5', gate_pass_id: 'r3', line_no: 1, name: 'Wall Putty Tub' }),
  ];
}

/** The board issues exactly two queries, told apart by which column the
 *  `.in()` names. `expires_at` rides along with the queue's `.in('status', …)`
 *  and must not select a set of its own. */
function builder(table = '') {
  let axis: 'status' | 'return_status' | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'lte', 'lt', 'gte', 'eq', 'ilike']) obj[m] = () => obj;
  obj.in = (col: string) => {
    if (col === 'status') axis = 'status';
    if (col === 'return_status') axis = 'return_status';
    return obj;
  };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data = table === 'v_gate_pass_items'
      ? OPEN_ITEMS
      : axis === 'return_status' ? OPEN_RETURNS : QUEUE;
    return Promise.resolve({ data, error: null, count: data.length }).then(onOk, onErr);
  };
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (table: string) => builder(table),
    rpc: () => ({
      maybeSingle: () => Promise.resolve({
        data: { id: 'u1', email: 'g@x.z', full_name: 'Ravi Kumar', role: 'guard', department_id: null,
                created_at: '2026-01-01T00:00:00Z' },
        error: null,
      }),
    }),
  }),
  pub: () => ({ from: () => builder() }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';

/** The figure inside a summary card — since 2026-08-23 this is the `<a>` the
 *  client asked the figure to be, not a button. `label` is 'RGP' / 'NRGP' /
 *  'Due back'. */
function figure(label: string): HTMLElement {
  return screen.getByTestId(`guard-figure-${label}`).querySelector('.gb-figure-value') as HTMLElement;
}

async function renderBoard() {
  render(
    <MemoryRouter>
      <GuardDashboard />
    </MemoryRouter>,
  );
  // The dashboard renders no pass rows any more, so the settled state is a
  // figure that has stopped showing its loading dash.
  await waitFor(() => expect(figure('RGP').textContent).not.toBe('—'));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRows();
});

describe('The greeting', () => {
  it('greets the signed-in guard by first name', async () => {
    await renderBoard();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Hello, Ravi/);
  });
});

describe('Pending OUT (Needs Approval)', () => {
  it('splits the gate queue into RGP and NRGP, and the two sum to the queue', async () => {
    await renderBoard();
    expect(figure('RGP').textContent).toBe('1');
    expect(figure('NRGP').textContent).toBe('2');
  });

  // REWRITTEN 2026-08-23 (client: "don't show the table on the same page …
  // show it on a different page"). It used to hold that pressing a figure
  // opened its list in place, on this page. A figure is a `<Link>` now, to
  // `/guard-dashboard/RGP` or `/guard-dashboard/NRGP` — `pendingOutDrill.test.tsx`
  // covers what that page shows and how it is counted; this only pins where
  // each figure points.
  it('is a link to the drill page for its own type', async () => {
    await renderBoard();
    expect(figure('RGP')).toHaveAttribute('href', '/guard-dashboard/RGP');
    expect(figure('NRGP')).toHaveAttribute('href', '/guard-dashboard/NRGP');
  });
});

describe('Pending RGP Return (Needs Verification)', () => {
  it('counts due-today material only — a late pass belongs to Overdue Returns', async () => {
    await renderBoard();
    // Three rows are still out: one due today, one late since May, one due in
    // October. Only the first is this figure's, and the late one is counted by
    // the Overdue Returns tile below — once, not twice.
    expect(figure('Due back').textContent).toBe('1');
  });

  // REWRITTEN 2026-08-23: this used to open the return queue in place. It is a
  // link to `/guard-dashboard/returns` now, the page `GuardDrill` renders for
  // that key.
  it('is a link to the return drill page', async () => {
    await renderBoard();
    expect(figure('Due back')).toHaveAttribute('href', '/guard-dashboard/returns');
  });
});

describe('Nothing is listed on this page, pressed or not', () => {
  // Client, 2026-08-19: "remove those pending out and all those return
  // verifications from the guard's view... put the card numbers drillable".
  // Since 2026-08-23 a figure drills to its own page rather than revealing a
  // list here at all, so this board never draws a table, pressed or not.
  it('renders no pass rows, no table and no View All control', async () => {
    await renderBoard();
    expect(document.querySelector('table')).toBeNull();
    expect(screen.queryByText('RGP-20260819-0057')).not.toBeInTheDocument();
    expect(screen.queryByText('RGP-20260518-0056')).not.toBeInTheDocument();
    expect(screen.queryByText(/View All/i)).not.toBeInTheDocument();
  });

  it('offers neither Approve OUT nor Record Return on this page', async () => {
    await renderBoard();
    expect(screen.queryByRole('link', { name: /Approve OUT/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Record Return/i })).not.toBeInTheDocument();
  });

  // The one search a guard has, since neither list is a page with a bar of its
  // own any more. It is not a filter over either list — `useGateSearch` looks a
  // pass number up over the whole register — so it is drawn ONCE, for the whole
  // board, above the figures.
  it('carries the global search and Scan QR, exactly once', async () => {
    await renderBoard();
    expect(screen.getAllByLabelText(/Search any pass/i)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Scan QR/i })).toHaveLength(1);
  });
});

describe('The mock-up skin', () => {
  // The client asked for this screen in their own palette and type, not the
  // house Quest gold / Antic Didone. These assertions are what stops a later
  // tidy-up from "restoring consistency" and undoing it.
  it('renders on the scoped .gb-board skin, and its h1 is not the gold display serif', async () => {
    await renderBoard();
    expect(document.querySelector('.gb-board')).not.toBeNull();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.className).toContain('gb-hello');
    expect(h1.className).not.toContain('page-title');
  });
});

describe('Quick actions', () => {
  it('offers only routes this role can actually open', async () => {
    await renderBoard();
    for (const [name, href] of [
      ['Scan QR / Pass No.', '/console'],
      ['Returns Due Today', '/returns'],
      ['Overdue Returns', '/overdue'],
    ] as const) {
      const link = screen.getByText(name).closest('a')!;
      expect(link).toHaveAttribute('href', href);
      expect(ROLE_ROUTES.guard).toContain(href);
    }
  });

  it('counts the LINES each tile opens, not the passes', async () => {
    await renderBoard();
    // /returns lists the lines of every pass the database grades due_today —
    // r1's two. A pass count would say "1".
    expect(screen.getByText('Returns Due Today').closest('a')).toHaveTextContent('2 items');
    // /overdue lists every line past its date and still owing — r2's first
    // line alone. Its second line is fully back; r3 is not late yet.
    expect(screen.getByText('Overdue Returns').closest('a')).toHaveTextContent('1 item');
  });

  it('puts no figure on Scan QR — the register is not a thing to count', async () => {
    await renderBoard();
    expect(screen.getByText('Scan QR / Pass No.').closest('a')).not.toHaveTextContent(/item/);
  });
});

describe('The old drill board is gone, not hidden', () => {
  it('renders no KPI drill labels and no pass cards', async () => {
    await renderBoard();
    for (const label of ['RGP Raised', 'Mismatch at Gate', 'Returned & Closed', 'Awaiting Return',
                         "Today's Summary", 'Pending for Gate Approval']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    expect(document.querySelector('[data-testid="pass-card-header"]')).toBeNull();
  });

  // REWRITTEN 2026-08-22, and again 2026-08-23 when Overdue Items came off
  // every sidebar. It used to hold that the guard's tabs were Dashboard ·
  // Pending OUT · Pending RGP Return · Overdue Items. The two list tabs went
  // with their routes — both lists are now pages a figure links to, never a
  // sidebar tab — and the Overdue tab went on its own: `/overdue` is still a
  // guard route, opened from the Overdue Returns quick action on this board.
  it('gives the guard a Dashboard and no other tab', () => {
    const guardTabs = ALL_LINKS.filter((l) => l.roles.includes('guard'));
    expect(guardTabs.map((l) => l.to)).toEqual(['/guard-dashboard']);
    for (const gone of ['/pending-out', '/pending-returns']) {
      expect(guardTabs.map((l) => l.to)).not.toContain(gone);
      expect(ROLE_ROUTES.guard).not.toContain(gone);
    }
    // The Search Pass route survives — Verify redirects onto it and the Scan QR
    // tile opens it — but it is not a tab.
    expect(guardTabs.map((l) => l.to)).not.toContain('/console');
    expect(ROLE_ROUTES.guard).toContain('/console');
  });
});
