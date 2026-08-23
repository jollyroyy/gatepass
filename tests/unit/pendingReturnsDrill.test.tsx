// Pending RGP Return (Needs Verification) - the return queue, drilled open on
// its OWN PAGE at `/guard-dashboard/returns` (client, 2026-08-23: "don't show
// the table on the same page. Show it on a different page, like you are
// showing the overdue details").
//
// REWRITTEN 2026-08-23. For one day (2026-08-22) this list opened in place,
// under the figure that counts it, on the guard's dashboard; the client took
// that back the same way as Pending OUT — see that file's header. `GuardDrill`
// is now the page the return figure links to for `key === 'returns'`;
// `PendingReturnsPanel` — unchanged by this move — is what it renders.
//
// What these cases exist to hold:
//   * It lists what is DUE TODAY or ALREADY LATE, and deliberately not every
//     open obligation: material due in October cannot be recorded on either
//     `/returns` or `/overdue` today, so a row for it would be a button that
//     cannot be pressed.
//   * Lateness is in WORDS ("(Due Today)" / "(3 Days Overdue)" under the date,
//     plus the Status pill), from the database's own `due_state`, never from
//     colour alone.
//   * Each row opens its own material lines IN PLACE on the chevron, which is
//     where a return is recorded line by line and quantity by quantity, while
//     the Action button beside it opens the pass's full record - the client's
//     two doors onto the same pass (2026-08-19).
//   * The list carries NO status tab strip and NO search bar of its own
//     (client, 2026-08-19). Both were removed the same day; these cases are
//     what stops either coming back by accident. The board's ONE global search
//     sits above the figures on the dashboard, and this page has neither a
//     figure nor a search box of its own.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Repair', expected_return_date: '2026-08-19', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: '2026-08-20T18:30:00Z', created_at: '2026-08-18T04:50:00Z',
    is_overdue: false, is_expired: false, due_state: 'due_today',
    item_count: 1, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

let OPEN_RETURNS: GatePassView[] = [];
let PHONE_ROWS: GatePassView[] = [];

function resetRows(): void {
  PHONE_ROWS = [];
  OPEN_RETURNS = [
    pass({ id: 'r1', pass_number: 'RGP-00056', expected_return_date: '2026-08-19',
           due_state: 'due_today', material_summary: 'Steel Props',
           total_quantity: 200, returned_quantity: 0 }),
    pass({ id: 'r2', pass_number: 'RGP-00055', return_status: 'partially_returned',
           expected_return_date: '2026-05-18', due_state: 'overdue', is_overdue: true,
           material_summary: 'Scaffolding Pipes', total_quantity: 150, returned_quantity: 50,
           visitor_company: '{"n":"XYZ Builders","a":"","v":"9000000002"}' }),
    // Still out, due in October — a real obligation, no barrier action today.
    pass({ id: 'r3', pass_number: 'RGP-00099', expected_return_date: '2026-10-01',
           due_state: 'ok', material_summary: 'Wall Putty' }),
  ];
}

function builder(table: string) {
  let phone = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'lte', 'lt', 'gte', 'eq', 'in']) obj[m] = () => obj;
  obj.ilike = () => { phone = true; return obj; };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data = table === 'v_gate_pass_items' ? [] : phone ? PHONE_ROWS : OPEN_RETURNS;
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
      Promise.resolve({ data: [{ outcome: 'ok', pass_id: 'far1', blacklist_match: null }], error: null }),
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

/** The drillable figure inside a summary card, on the dashboard. The return
 *  card's is unlabelled on the mock-up, so its test id is 'Due back'. */
function figure(label = 'Due back'): HTMLElement {
  return screen.getByTestId('guard-figure-' + label).querySelector('.gb-figure-value') as HTMLElement;
}

/** `GuardDrill` at `/guard-dashboard/returns` — the page the return figure
 *  opens since 2026-08-23. */
async function renderPage() {
  render(
    <MemoryRouter initialEntries={['/guard-dashboard/returns']}>
      <Routes>
        <Route path="/guard-dashboard" element={<div>DASHBOARD</div>} />
        <Route path="/guard-dashboard/:key" element={<GuardDrill />} />
        <Route path="/pass/:id" element={<div>RECORD PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('RGP-00056')).toBeInTheDocument());
}

/** The dashboard itself, for the cases about its own search bar rather than
 *  about the drilled list. */
async function renderBoard() {
  render(
    <MemoryRouter initialEntries={['/guard-dashboard']}>
      <Routes>
        <Route path="/guard-dashboard" element={<GuardDashboard />} />
        <Route path="/pass/:id" element={<div>RECORD PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(figure().textContent).not.toBe('-'));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRows();
});

describe('What is on the page', () => {
  it('lists due-today and overdue material, and not what is due later', async () => {
    await renderPage();
    expect(screen.getByText('RGP-00056')).toBeInTheDocument();
    expect(screen.getByText('RGP-00055')).toBeInTheDocument();
    expect(screen.queryByText('RGP-00099')).not.toBeInTheDocument();
    expect(screen.getByText(/Showing 1 to 2 of 2 entries/)).toBeInTheDocument();
  });

  it('states lateness in words, never in colour alone', async () => {
    await renderPage();
    // The Status pill on the late row, and the note under its date. A partly
    // returned pass reads "Partially Returned" — that outranks lateness on the pill,
    // which is exactly why the date carries the day count as well.
    // Scoped to the table: the legend under it names the same four states, and
    // that is the point of a legend — the words appear twice on purpose.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Partially Returned')).toBeInTheDocument();
    expect(table.getByText(/Days Overdue/)).toBeInTheDocument();
    expect(table.getByText('(Due Today)')).toBeInTheDocument();
  });

  it('carries no overflow menu — the pass number is already the way to the record', async () => {
    // Client, 2026-08-19: "remove the three dots from the right-hand side of
    // each stacked card." A row's Action cell is one control now.
    await renderPage();
    const row = screen.getByText('RGP-00056').closest('tr')!;
    expect(within(row).queryByLabelText(/Open the full record/i)).not.toBeInTheDocument();
    expect(row.querySelector('.gb-kebab')).toBeNull();
    // The pass number itself still opens it.
    expect(within(row).getByText('RGP-00056').closest('a')).toHaveAttribute('href', '/pass/r1');
  });

  it('shows what has come back against what went out', async () => {
    await renderPage();
    // Quantity, not lines: this page's whole subject is that 50 of 150 is a
    // real answer, and a line count would call that pass 0 of 1 returned.
    expect(screen.getByText('50 of 150 returned')).toBeInTheDocument();
    expect(screen.getByText('(33.3%)')).toBeInTheDocument();
    expect(screen.getByText('0 of 200 returned')).toBeInTheDocument();
  });

  it('opens the material lines in place, on the chevron', async () => {
    await renderPage();
    // The return is recorded HERE, per line — a page load between a guard and
    // the material standing in front of them is a page load too many.
    fireEvent.click(screen.getByRole('button', { name: /Show items in RGP-00056/ }));
    await waitFor(() =>
      expect(screen.getByText(/Items in this Pass/)).toBeInTheDocument());
  });

  it('sends Verify Return to the pass record, the second door onto the pass', async () => {
    await renderPage();
    const actions = screen.getAllByRole('link', { name: /Verify Return/ });
    expect(actions).toHaveLength(2);
    expect(actions.map((a) => a.getAttribute('href')).sort()).toEqual(['/pass/r1', '/pass/r2']);
  });

  it('says so plainly when nothing is due', async () => {
    OPEN_RETURNS = [];
    render(
      <MemoryRouter initialEntries={['/guard-dashboard/returns']}>
        <Routes>
          <Route path="/guard-dashboard" element={<div>DASHBOARD</div>} />
          <Route path="/guard-dashboard/:key" element={<GuardDrill />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Nothing is due back today, and nothing is late/)).toBeInTheDocument());
  });
});

describe('The list carries neither tabs nor a search bar of its own', () => {
  // Client, 2026-08-19. The four status counts said in a strip what the Status
  // column and the filter bar already say per row, and the global search
  // belongs where a guard goes looking for a pass they cannot see — that is
  // the dashboard's, above its figures, and this drill page carries neither.
  it('has no status tab strip', async () => {
    await renderPage();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    for (const label of ['All (2)', 'Due Today (1)', 'Overdue (1)', 'Returned Partially (1)']) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
  });

  // REWRITTEN 2026-08-23. It used to hold that the global search was drawn
  // once, on the dashboard, above the figures a guard pressed to drill in
  // place. The figures moved to `<Link>`s and this list is a route of its own
  // now, so the search lives only where it always did — on the dashboard —
  // and this page draws none of its own.
  it('draws the global search on the dashboard', async () => {
    await renderBoard();
    expect(screen.getAllByLabelText(/Search any pass/i)).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Scan QR/ })).toHaveLength(1);
  });

  it('draws none of its own on this drill page', async () => {
    await renderPage();
    expect(screen.queryByLabelText(/Search any pass/i)).not.toBeInTheDocument();
    const list = screen.getByRole('region', { name: /Pending RGP Return/ });
    expect(within(list).queryByLabelText(/Search any pass/i)).not.toBeInTheDocument();
  });

  // REWRITTEN 2026-08-23: there is no "press to reveal, press again to hide"
  // state on this page any more. The figure that used to toggle it is now a
  // `<Link>` on the dashboard (`guardDashboard.test.tsx`); the way back off
  // this page is the "Back to dashboard" link `DrillPageShell` draws.
  it('always shows its list, and offers a way back to the dashboard', async () => {
    await renderPage();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to dashboard/i })).toHaveAttribute(
      'href', '/guard-dashboard');
  });

  it('still narrows through the filter bar, which is what replaced them', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText('Vendor'), { target: { value: 'XYZ Builders' } });
    await waitFor(() => expect(screen.queryByText('RGP-00056')).not.toBeInTheDocument());
    expect(screen.getByText('RGP-00055')).toBeInTheDocument();
  });
});
