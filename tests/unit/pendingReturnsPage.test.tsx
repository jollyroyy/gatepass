// Pending RGP Return (Needs Verification) — the return queue as a page of its
// own (client mock-up, 2026-08-19), opened by the dashboard's figure.
//
// What these cases exist to hold:
//   * It lists what is DUE TODAY or ALREADY LATE, and deliberately not every
//     open obligation: material due in October cannot be recorded on either
//     `/returns` or `/overdue` today, so a row for it would be a button that
//     cannot be pressed.
//   * Lateness is in WORDS ("(Due Today)" / "(3 Days Overdue)" under the date,
//     plus the Status pill), from the database's own `due_state`, never from
//     colour alone.
//   * Each row's action OPENS the pass's own material lines, which is where a
//     return is recorded line by line and quantity by quantity (2026-08-19,
//     second pass — it used to be a link to /returns or /overdue).
//   * The same GLOBAL search sits top right — a pass number typed here reaches
//     the whole register, not these rows.
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

import PendingReturnsPage from '../../src/pages/Security/PendingReturnsPage';

async function renderPage() {
  render(
    <MemoryRouter initialEntries={['/pending-returns']}>
      <Routes>
        <Route path="/pending-returns" element={<PendingReturnsPage />} />
        <Route path="/pass/:id" element={<div>RECORD PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByText('RGP-00056')).toBeInTheDocument());
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
    // returned pass reads "Partial" — that outranks lateness on the pill,
    // which is exactly why the date carries the day count as well.
    // Scoped to the table: the legend under it names the same four states, and
    // that is the point of a legend — the words appear twice on purpose.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Partial')).toBeInTheDocument();
    expect(table.getByText(/Days Overdue/)).toBeInTheDocument();
    expect(table.getByText('(Due Today)')).toBeInTheDocument();
  });

  it('shows what has come back against what went out', async () => {
    await renderPage();
    // Quantity, not lines: this page's whole subject is that 50 of 150 is a
    // real answer, and a line count would call that pass 0 of 1 returned.
    expect(screen.getByText('50 of 150 returned')).toBeInTheDocument();
    expect(screen.getByText('(33.3%)')).toBeInTheDocument();
    expect(screen.getByText('0 of 200 returned')).toBeInTheDocument();
  });

  it('opens the material lines rather than sending the guard to another page', async () => {
    await renderPage();
    // The return is recorded HERE, per line, so the action expands the row.
    // A link to /returns or /overdue would be a page load between a guard and
    // the material standing in front of them.
    const actions = screen.getAllByRole('button', { name: /Verify \/ Update Return/ });
    expect(actions).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Record Return' })).not.toBeInTheDocument();
    fireEvent.click(actions[0]);
    await waitFor(() =>
      expect(screen.getByText(/Items in this Pass/)).toBeInTheDocument());
  });

  it('says so plainly when nothing is due', async () => {
    OPEN_RETURNS = [];
    render(
      <MemoryRouter>
        <PendingReturnsPage />
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(screen.getByText(/Nothing is due back today, and nothing is late/)).toBeInTheDocument());
  });
});

describe('The toolbar', () => {
  // Only an RGP comes back, so a type tab strip with one live option would be
  // a control that teaches nothing. The tabs here are STATUS instead, and
  // their counts are over the whole list — never the filtered one.
  it('carries the global search and Scan QR, and status tabs rather than type tabs', async () => {
    await renderPage();
    expect(screen.getByLabelText(/Search any pass/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scan QR/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Due Today (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Overdue (1)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Returned Partially (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /NRGP/ })).not.toBeInTheDocument();
  });

  it('narrows to one tab without changing the counts beside the others', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'Overdue (1)' }));
    await waitFor(() => expect(screen.queryByText('RGP-00056')).not.toBeInTheDocument());
    expect(screen.getByText('RGP-00055')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'All (2)' })).toBeInTheDocument();
  });

  it('reaches a pass that is not on this page at all', async () => {
    await renderPage();
    fireEvent.change(screen.getByLabelText(/Search any pass/i), { target: { value: 'NRGP-00777' } });
    fireEvent.submit(screen.getByLabelText(/Search any pass/i).closest('form')!);
    await waitFor(() => expect(screen.getByText('RECORD PAGE')).toBeInTheDocument());
  });
});
