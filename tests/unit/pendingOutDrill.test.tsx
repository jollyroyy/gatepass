// Pending OUT (Needs Approval) - the gate queue, drilled open on its OWN PAGE
// at `/guard-dashboard/RGP` / `/guard-dashboard/NRGP` (client, 2026-08-23:
// "don't show the table on the same page. Show it on a different page, like
// you are showing the overdue details").
//
// REWRITTEN 2026-08-23. For one day (2026-08-22) this list opened in place,
// under the figure that counts it, on the guard's dashboard. The client took
// that back: a KPI card's table belongs on a page of its own, the way Overdue
// already worked. `GuardDrill` (`src/pages/Security/GuardDrill.tsx`) is that
// page; `PendingOutPanel` — unchanged by this move — is what it renders for
// `key === 'RGP' | 'NRGP'`.
//
// What these cases exist to hold:
//   * THE FIGURE IS THE WAY IN, and the list it opens is the array it counted:
//     one `useGuardQueues` read, `pendingOutOf` once, handed straight to the
//     panel — now via a route rather than in-place state.
//   * THE RGP AND NRGP FIGURES EACH OPEN THEIR OWN TAB, so the drill lands on
//     the rows behind the number rather than on a list to be narrowed again.
//   * The ACTION IS "APPROVE OUT" - the client's own word, replacing "Verify at
//     Gate" - and it is drawn only while `match_pass` would still accept the
//     pass (`canVerifyAtGate`). A pass that expired while the board sat open
//     degrades to a link that works instead of a button that always fails.
//   * The tab counts, the filter options and the rows are three readings of ONE
//     loaded array, so a count can never disagree with the list under it.
//   * A row opens its own material lines in place, loaded on demand.
//   * THE SEARCH IS GLOBAL AND LIVES ON THE DASHBOARD, NOT ON THIS PAGE — a
//     pass number goes through `lookup_pass` over the whole register, and a
//     mobile number through an unfiltered query, both reaching passes that are
//     not in the queue. `GuardDrill` renders neither the bar nor the scanner;
//     those cases render `GuardDashboard` instead, which still carries both.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

const FUTURE = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Kumar',
    visitor_name: 'Ravi', visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Formwork Support', expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: FUTURE, created_at: '2026-08-19T04:50:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 3, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

let QUEUE: GatePassView[] = [];
// What the global mobile-number search resolves to — deliberately a pass that
// is NOT in the queue, which is the whole point of the search being global.
let PHONE_ROWS: GatePassView[] = [];
let LOOKUP_ID: string | null = null;

const ITEMS = [
  { id: 'i1', gate_pass_id: 'q1', line_no: 1, name: 'Steel Props',
    description: 'Adjustable Steel Prop 3.0m', quantity: 150, unit: 'nos' },
  { id: 'i2', gate_pass_id: 'q1', line_no: 2, name: 'Base Plates',
    description: 'Steel Base Plate', quantity: 30, unit: 'nos' },
];

function resetRows(): void {
  LOOKUP_ID = 'far1';
  PHONE_ROWS = [];
  QUEUE = [
    pass({ id: 'q1', pass_number: 'RGP-00057', type: 'RGP', created_at: '2026-08-19T04:50:00Z' }),
    pass({ id: 'q2', pass_number: 'NRGP-00081', type: 'NRGP', item_count: 2, total_quantity: 500,
           department_name: 'Housekeeping', raised_by_name: 'Suresh Babu',
           visitor_company: '{"n":"ABC Suppliers","a":"","v":"9000000001"}',
           created_at: '2026-08-19T04:55:00Z' }),
    pass({ id: 'q3', pass_number: 'NRGP-00080', type: 'NRGP', item_count: 1, total_quantity: 10000,
           department_name: 'Retail Ops', raised_by_name: 'Arun Singh',
           visitor_company: '{"n":"XYZ Traders","a":"","v":"9000000002"}',
           created_at: '2026-08-19T05:00:00Z' }),
  ];
}

/** One builder per `from()`, told apart by the table it was asked for and by
 *  which narrowing was called on it. `ilike` is the mobile-number search — the
 *  one query on this page that is NOT the queue. */
function builder(table: string) {
  let phone = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'lte', 'lt', 'gte', 'eq', 'in']) obj[m] = () => obj;
  obj.ilike = () => { phone = true; return obj; };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data = table === 'v_gate_pass_items' ? ITEMS : phone ? PHONE_ROWS : QUEUE;
    return Promise.resolve({ data, error: null, count: data.length }).then(onOk, onErr);
  };
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

// The viewfinder itself needs a camera; this file is about what the PAGE does
// while it is open, so it is stubbed to a marker.
vi.mock('../../src/components/QrScanner', () => ({
  default: () => <div data-testid="qr-viewfinder" />,
}));

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: (t: string) => builder(t),
    rpc: () =>
      Promise.resolve({
        data: LOOKUP_ID ? [{ outcome: 'ok', pass_id: LOOKUP_ID, blacklist_match: null }] : [],
        error: null,
      }),
  }),
  pub: () => ({ from: (t: string) => builder(t) }),
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
    channel: () => ch,
    removeChannel: () => undefined,
  },
}));

import GuardDashboard from '../../src/pages/Security/GuardDashboard';
import GuardDrill from '../../src/pages/Security/GuardDrill';

/** The drillable figure inside a summary card, on the dashboard. */
function figure(label: string): HTMLElement {
  return screen.getByTestId('guard-figure-' + label).querySelector('.gb-figure-value') as HTMLElement;
}

/** `GuardDrill` at `/guard-dashboard/:key` — the page a Pending OUT figure
 *  opens since 2026-08-23. Rendered inside a router that also serves
 *  `/guard-dashboard` (the back link) and `/pass/:id` (every row's action). */
async function renderDrillPage(key: 'RGP' | 'NRGP' = 'RGP') {
  render(
    <MemoryRouter initialEntries={[`/guard-dashboard/${key}`]}>
      <Routes>
        <Route path="/guard-dashboard" element={<div>DASHBOARD</div>} />
        <Route path="/guard-dashboard/:key" element={<GuardDrill />} />
        <Route path="/pass/:id" element={<div>RECORD PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Land on the drill page for `press`, then optionally switch to `tab` —
 *  most cases below are about the whole queue, so the default puts the RGP
 *  figure's page on the All tab. */
async function renderDrill(press: 'RGP' | 'NRGP' = 'RGP', tab: string | null = 'All') {
  await renderDrillPage(press);
  await waitFor(() => expect(screen.getByRole('tablist', { name: 'Pass type' })).toBeInTheDocument());
  if (tab && tab !== press) {
    fireEvent.click(screen.getByRole('tab', { name: new RegExp('^' + tab + ' ') }));
  }
}

async function renderPage() {
  await renderDrill();
  await waitFor(() => expect(screen.getByText('RGP-00057')).toBeInTheDocument());
}

/** The dashboard itself, for the cases that are about its search bar and
 *  scanner rather than about the drilled list. */
async function renderBoard() {
  render(
    <MemoryRouter initialEntries={['/guard-dashboard']}>
      <Routes>
        <Route path="/guard-dashboard" element={<GuardDashboard />} />
        <Route path="/pass/:id" element={<div>RECORD PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(figure('RGP').textContent).not.toBe('-'));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRows();
});

describe('The queue', () => {
  it('names the party, the department, the vehicle and who asked, oldest first', async () => {
    await renderPage();
    const rows = screen.getAllByRole('row');
    // Row 0 is the head; the oldest pass leads. Scoped to the row on purpose:
    // a party and a department are also <option>s in the filter bar, which is
    // itself the point — the selects are built from the loaded rows.
    const first = within(rows[1]);
    expect(first.getByText('RGP-00057')).toBeInTheDocument();
    expect(first.getByText('LMN Contractors')).toBeInTheDocument();
    expect(first.getByText('Engineering')).toBeInTheDocument();
    expect(first.getByText('KA01AB1234')).toBeInTheDocument();
    expect(first.getByText('Ramesh Kumar')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Housekeeping')).toBeInTheDocument();
  });

  it('offers Approve OUT — the client\'s word — while match_pass would accept the pass', async () => {
    await renderPage();
    const links = screen.getAllByRole('link', { name: 'Approve OUT' });
    expect(links).toHaveLength(3);
    // It opens the DECISION itself (client, 2026-08-23: Approve "should
    // directly take him to the green-coloured Approve or Reject button"), which
    // draws the whole pass and its lines above the two buttons.
    expect(links[0]).toHaveAttribute('href', '/verify/q1');
    // The old wording is gone, not merely unused.
    expect(screen.queryByText('Verify at Gate')).not.toBeInTheDocument();
  });

  it('degrades an expired pass to a link that works instead of a button that cannot', async () => {
    QUEUE = [pass({ id: 'q1', pass_number: 'RGP-00057', expires_at: '2026-01-01T00:00:00Z' })];
    await renderPage();
    expect(screen.queryByRole('link', { name: 'Approve OUT' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View pass' })).toHaveAttribute('href', '/pass/q1');
  });
});

describe('The type tabs and the filters', () => {
  it('counts every tab over the whole queue, not the filtered one', async () => {
    await renderPage();
    expect(screen.getByRole('tab', { name: 'All (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'RGP (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'NRGP (2)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'RGP (1)' }));
    expect(screen.queryByText('NRGP-00081')).not.toBeInTheDocument();
    // The counts are unchanged by the narrowing — a tab reading (0) is what
    // tells a reader not to click it.
    expect(screen.getByRole('tab', { name: 'NRGP (2)' })).toBeInTheDocument();
  });

  // REWRITTEN 2026-08-23: this is now the page the NRGP figure links to,
  // `/guard-dashboard/NRGP`, and it lands already narrowed to the type the
  // figure counted.
  it('opens already narrowed to the type the pressed figure counted', async () => {
    await renderDrill('NRGP', null);
    await waitFor(() => expect(screen.getByText('NRGP-00081')).toBeInTheDocument());
    expect(screen.queryByText('RGP-00057')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'NRGP (2)' })).toHaveAttribute('aria-selected', 'true');
  });

  // REWRITTEN 2026-08-23: closing the list by pressing the figure again only
  // made sense while the list opened in place. The figure is a `<Link>` to
  // this page now (see `guardDashboard.test.tsx`), and this page's own way
  // back is the "Back to dashboard" link `DrillPageShell` draws.
  it('opens the RGP figure on the RGP tab, and offers a way back to the dashboard', async () => {
    await renderDrill('RGP', null);
    await waitFor(() => expect(screen.getByText('RGP-00057')).toBeInTheDocument());
    expect(screen.queryByText('NRGP-00081')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'RGP (1)' })).toHaveAttribute('aria-selected', 'true');

    const back = screen.getByRole('link', { name: /Back to dashboard/i });
    expect(back).toHaveAttribute('href', '/guard-dashboard');
  });

  // REWRITTEN 2026-08-23: there is no "press to reveal" state on this page any
  // more — the route itself is what a figure opens, and it always shows its
  // list. An unrecognised key is the one case this page refuses, sending the
  // reader back to the board rather than at a blank drill.
  it('sends an unrecognised key back to the dashboard rather than drawing a list', async () => {
    render(
      <MemoryRouter initialEntries={['/guard-dashboard/bogus']}>
        <Routes>
          <Route path="/guard-dashboard" element={<div>DASHBOARD</div>} />
          <Route path="/guard-dashboard/:key" element={<GuardDrill />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('DASHBOARD')).toBeInTheDocument());
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('narrows by department and puts it all back on Reset', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'Retail Ops' } });
    expect(screen.queryByText('RGP-00057')).not.toBeInTheDocument();
    expect(screen.getByText('NRGP-00080')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reset/ }));
    expect(screen.getByText('RGP-00057')).toBeInTheDocument();
  });

  it('reverses the queue on Newest First', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'newest' } });
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('NRGP-00080')).toBeInTheDocument();
  });
});

describe('A row opens its own material lines', () => {
  it('loads the lines only when the row is opened', async () => {
    await renderPage();
    expect(screen.queryByText('Adjustable Steel Prop 3.0m')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show items in RGP-00057' }));
    await waitFor(() =>
      expect(screen.getByText('Adjustable Steel Prop 3.0m')).toBeInTheDocument());
    expect(screen.getByText('Items in this Pass (3)')).toBeInTheDocument();
    // Validity, purpose and who authorised it — what a guard decides on.
    expect(screen.getByText('Pass Validity')).toBeInTheDocument();
    expect(screen.getByText('Formwork Support')).toBeInTheDocument();
  });

  // The mock-up's UOM column, and the client's own reason for it: a guard
  // verifying what leaves the gate counts a physical load against the line in
  // front of them, so each quantity is read with its unit — including `nos`,
  // which every other screen in this app leaves unnamed.
  it('names the unit beside every quantity, a plain count included', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Show items in RGP-00057' }));
    await waitFor(() =>
      expect(screen.getByText('Adjustable Steel Prop 3.0m')).toBeInTheDocument());

    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toContain('Unit');
    expect(heads).toContain('Quantity');

    const line = screen.getByText('Adjustable Steel Prop 3.0m').closest('tr') as HTMLElement;
    // The seventh cell is the line's VALUE, added to this panel by the pass that
    // brought `guardValueColumns.test.tsx` with it; this expectation was left
    // naming five columns and had been failing on `main` since. An unpriced
    // line prints a dash — `approx_value` is optional, and "nothing declared"
    // is not "₹0". The fourth is MAKE / MODEL (client, 2026-08-23), dashed here
    // on a line raised before migration 045.
    expect(within(line).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '1', 'Steel Props', 'Adjustable Steel Prop 3.0m', '—', '150', 'Numbers', '—',
    ]);
  });
});

describe('The search is global, and lives on the dashboard, not this page', () => {
  it('sends an exact pass number through lookup_pass and opens that record', async () => {
    await renderBoard();
    fireEvent.change(screen.getByLabelText(/Search any pass/i), { target: { value: 'RGP-00999' } });
    fireEvent.submit(screen.getByLabelText(/Search any pass/i).closest('form')!);
    // `far1` is not in the queue at all — the search reached past this page.
    await waitFor(() => expect(screen.getByText('RECORD PAGE')).toBeInTheDocument());
  });

  it('lists every pass a mobile number carries, queue or not', async () => {
    PHONE_ROWS = [
      pass({ id: 'far1', pass_number: 'RGP-00001', status: 'matched',
             visitor_company: '{"n":"Old Party","a":"","v":"9876543210"}' }),
      pass({ id: 'far2', pass_number: 'RGP-00002', status: 'matched',
             visitor_company: '{"n":"Old Party","a":"","v":"9876543210"}' }),
    ];
    await renderBoard();
    fireEvent.change(screen.getByLabelText(/Search any pass/i), { target: { value: '9876543210' } });
    fireEvent.submit(screen.getByLabelText(/Search any pass/i).closest('form')!);

    await waitFor(() => expect(screen.getByTestId('guard-phone-results')).toBeInTheDocument());
    expect(screen.getByText('RGP-00001')).toBeInTheDocument();
    expect(screen.getByText('RGP-00002')).toBeInTheDocument();
    // Neither is in the gate queue, and a matched pass gets no Approve OUT.
    expect(screen.queryByRole('link', { name: 'Approve OUT' })).not.toBeInTheDocument();
  });

  it('this page itself draws no search bar of its own', async () => {
    await renderPage();
    expect(screen.queryByLabelText(/Search any pass/i)).not.toBeInTheDocument();
  });
});

describe('The pager', () => {
  it('shows one page of rows and says what it is showing', async () => {
    QUEUE = Array.from({ length: 12 }, (_, i) =>
      pass({ id: `q${i}`, pass_number: `RGP-000${String(i).padStart(2, '0')}`,
             created_at: `2026-08-19T0${i % 10}:00:00Z` }));
    await renderDrill();
    await waitFor(() => expect(screen.getByText(/Showing 1 to 10 of 12 entries/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText(/Showing 11 to 12 of 12 entries/)).toBeInTheDocument();
  });
});

describe('Opening the scanner clears the dashboard, not this page', () => {
  // REWRITTEN 2026-08-23: the scanner lives on `GuardDashboard`, which no
  // longer draws any list to clear — its figures and quick actions are what
  // stand down while the viewfinder is up. This page (`GuardDrill`) has no
  // scanner and no search of its own, so its list and filter bar are simply
  // always there.
  it('drops the figures and quick actions on the dashboard while the viewfinder is up', async () => {
    await renderBoard();
    expect(screen.getByTestId('guard-figure-RGP')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Scan QR/i }));

    expect(screen.getByTestId('qr-viewfinder')).toBeInTheDocument();
    expect(screen.queryByTestId('guard-figure-RGP')).not.toBeInTheDocument();
    // The search bar itself stays — a damaged code is typed in, not scanned.
    expect(screen.getByLabelText(/Search any pass/i)).toBeInTheDocument();
  });

  it('puts the dashboard back when the scanner is closed', async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Scan QR/i }));
    fireEvent.click(screen.getByRole('button', { name: /Close Scanner/i }));
    expect(screen.getByTestId('guard-figure-RGP')).toBeInTheDocument();
  });

  it('this page keeps its tab strip and table regardless — it has no scanner', async () => {
    await renderPage();
    expect(screen.getByRole('tablist', { name: 'Pass type' })).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});
