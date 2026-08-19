// Pending OUT (Needs Approval) — the gate queue as a page of its own, drawn to
// the client's mock-up (2026-08-19).
//
// What these cases exist to hold:
//   * The ACTION IS "APPROVE OUT" — the client's own word, replacing "Verify at
//     Gate" — and it is drawn only while `match_pass` would still accept the
//     pass (`canVerifyAtGate`). A pass that expired while the page sat open
//     degrades to a link that works instead of a button that always fails.
//   * The tab counts, the filter options and the rows are three readings of ONE
//     loaded array, so a count can never disagree with the list under it.
//   * A row opens its own material lines in place, loaded on demand.
//   * THE SEARCH IS GLOBAL. It is not a filter over these rows: a pass number
//     goes through `lookup_pass` over the whole register, and a mobile number
//     through an unfiltered query. Both reach passes that are not in the queue.
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

import PendingOutPage from '../../src/pages/Security/PendingOutPage';

/** Rendered inside a router that also serves `/pass/:id`, because a resolved
 *  search NAVIGATES to the record rather than drawing it in this screen's
 *  fixed-light skin. */
async function renderPage(entry = '/pending-out') {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/pending-out" element={<PendingOutPage />} />
        <Route path="/pass/:id" element={<div>RECORD PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('RGP-00057')).toBeInTheDocument());
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

  it('opens already narrowed when the dashboard figure said which type it counted', async () => {
    render(
      <MemoryRouter initialEntries={['/pending-out?type=NRGP']}>
        <Routes>
          <Route path="/pending-out" element={<PendingOutPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('NRGP-00081')).toBeInTheDocument());
    expect(screen.queryByText('RGP-00057')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'NRGP (2)' })).toHaveAttribute('aria-selected', 'true');
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
    expect(within(line).getAllByRole('cell').map((c) => c.textContent)).toEqual([
      '1', 'Steel Props', 'Adjustable Steel Prop 3.0m', '150', 'Numbers',
    ]);
  });
});

describe('The search is global, and is not this list', () => {
  it('sends an exact pass number through lookup_pass and opens that record', async () => {
    await renderPage();
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
    await renderPage();
    fireEvent.change(screen.getByLabelText(/Search any pass/i), { target: { value: '9876543210' } });
    fireEvent.submit(screen.getByLabelText(/Search any pass/i).closest('form')!);

    await waitFor(() => expect(screen.getByTestId('guard-phone-results')).toBeInTheDocument());
    expect(screen.getByText('RGP-00001')).toBeInTheDocument();
    expect(screen.getByText('RGP-00002')).toBeInTheDocument();
    // Neither is in the gate queue, and a matched pass gets no Approve OUT.
    expect(screen.queryByRole('link', { name: 'Approve OUT' })).not.toBeInTheDocument();
  });
});

describe('The pager', () => {
  it('shows one page of rows and says what it is showing', async () => {
    QUEUE = Array.from({ length: 12 }, (_, i) =>
      pass({ id: `q${i}`, pass_number: `RGP-000${String(i).padStart(2, '0')}`,
             created_at: `2026-08-19T0${i % 10}:00:00Z` }));
    render(
      <MemoryRouter>
        <PendingOutPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/Showing 1 to 10 of 12 entries/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    expect(screen.getByText(/Showing 11 to 12 of 12 entries/)).toBeInTheDocument();
  });
});
