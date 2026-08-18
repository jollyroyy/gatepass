// Search Pass resolves a query to the FULL gate-pass record, in place.
//
// What this pins, and how each would silently regress:
//   * an exact pass number renders Gate Pass Details on the same page instead
//     of jumping to /verify — the old behaviour, which skipped the record
//     entirely;
//   * `lookup_pass` is still what decides a pass number, so the scan attempt
//     is still logged;
//   * a mobile number only ONE pass carries opens that record directly rather
//     than a one-row list;
//   * the record's figures are the rows underneath it: 1 of 2 items returned
//     at 50%, and one line still needing attention.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';

const PASS: GatePassView = {
  id: 'p1',
  pass_number: 'RGP-OUT-20260818-0481',
  type: 'RGP',
  direction: 'out',
  status: 'matched',
  department_id: 'd1',
  department_name: 'Engineering',
  department_code: 'ENG',
  raised_by: 'u1',
  raised_by_name: 'Neha Kapoor',
  visitor_name: 'Rohan Sharma',
  visitor_company: JSON.stringify({ n: 'BSC', a: 'Kolkata', v: '+91 98765-43210' }),
  vehicle_number: 'WB01AB1234',
  purpose: 'Level 2 — Service Corridor',
  expected_return_date: '2026-08-18',
  return_status: 'partially_returned',
  actual_return_date: null,
  verified_by: 'g1',
  verified_by_name: 'Guard One',
  verified_at: '2026-08-18T04:20:00.000Z',
  flag_reason: null,
  qr_token: 'tok',
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
  created_at: '2026-08-18T04:12:00.000Z',
  updated_at: '2026-08-18T10:50:00.000Z',
  is_overdue: false,
  is_expired: false,
  flagged_at: null,
  hod_reviewed_at: null,
  item_count: 2,
  total_quantity: 3,
  returned_quantity: 1,
  material_summary: 'Laptop, Drill',
  total_value: 91000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1',
    gate_pass_id: 'p1',
    line_no: 1,
    name: 'Dell Precision Laptop 5570',
    description: 'IT Equipment',
    purpose: 'site work',
    expected_return_date: null,
    quantity: 1,
    unit: 'nos',
    serial_no: 'IT-LTP-0842',
    approx_value: 90000,
    returned_qty: 1,
    returned_at: '2026-08-18T10:48:00.000Z',
    department_id: 'd1',
    is_open: false,
    created_at: '2026-08-18T04:12:00.000Z',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ITEMS: GatePassItemView[] = [
  item({}),
  item({ id: 'i2', line_no: 2, name: 'Bosch Cordless Drill', description: 'Power Tool', serial_no: 'TL-DRL-2198', quantity: 2, returned_qty: 0, returned_at: null, approx_value: 1000 }),
];

const VERIFS = [
  { id: 'v1', gate_pass_id: 'p1', action: 'matched', security_user_id: 'g1', verified_quantity: 3, verified_vehicle: null, remarks: null, gate_name: null, device_info: null, line_details: null, checks: null, created_at: '2026-08-18T04:20:00.000Z', security_name: 'Guard One' },
  { id: 'v2', gate_pass_id: 'p1', action: 'returned', security_user_id: 'g1', verified_quantity: 1, verified_vehicle: null, remarks: null, gate_name: null, device_info: null, line_details: null, checks: null, created_at: '2026-08-18T10:50:00.000Z', security_name: 'Guard One' },
];

let searchRows: GatePassView[] = [];
const rpcCalls: string[] = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ch: any = {};
ch.on = () => ch;
ch.subscribe = () => ch;

vi.mock('../../src/supabaseClient', () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    let isSearch = false;
    for (const m of ['select', 'eq', 'order', 'gte', 'lt', 'in', 'limit']) o[m] = () => o;
    o.ilike = () => {
      isSearch = true;
      return o;
    };
    const rows = () => {
      if (table === 'v_gate_pass_items') return ITEMS;
      if (table === 'v_verifications') return VERIFS;
      // The queue query and the phone search both read v_gate_passes; only the
      // latter narrows with ilike.
      return isSearch ? searchRows : [];
    };
    o.maybeSingle = () => Promise.resolve({ data: PASS, error: null });
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: rows(), error: null }).then(ok, err);
    return o;
  };
  return {
    gp: () => ({
      from: (table: string) => builder(table),
      rpc: (name: string) => {
        rpcCalls.push(name);
        return Promise.resolve({ data: [{ outcome: 'ok', pass_id: 'p1', blacklist_match: null }], error: null });
      },
    }),
    pub: () => ({ from: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u1' } } }) },
      channel: vi.fn(() => ch),
      removeChannel: () => undefined,
    },
  };
});

async function renderConsole() {
  const GateConsole = (await import('../../src/pages/Security/GateConsole')).default;
  render(
    <MemoryRouter>
      <GateConsole />
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId('gate-lookup')).toBeInTheDocument());
}

function search(text: string) {
  fireEvent.change(screen.getByLabelText('Find a pass by number or mobile'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
}

describe('Search Pass — an exact query opens the whole record in place', () => {
  beforeEach(() => {
    searchRows = [];
    rpcCalls.length = 0;
    vi.clearAllMocks();
  });

  it('renders Gate Pass Details for an exact pass number, still via lookup_pass', async () => {
    await renderConsole();
    search('RGP-OUT-20260818-0481');

    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    expect(rpcCalls).toContain('lookup_pass');
    expect(screen.getByRole('heading', { name: 'Gate Pass Details' })).toBeInTheDocument();
    // Twice on purpose: the breadcrumb and the summary card's identity line.
    expect(screen.getAllByText('RGP-OUT-20260818-0481')).toHaveLength(2);
    expect(screen.getByText('Rohan Sharma')).toBeInTheDocument();
    expect(screen.getByText('Neha Kapoor')).toBeInTheDocument();
    expect(screen.getByText('Level 2 — Service Corridor')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /print pass/i })).toBeInTheDocument();
  });

  it('opens the record straight away when one pass carries that mobile number', async () => {
    searchRows = [PASS];
    await renderConsole();
    search('9876543210');

    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    // A one-row list would be a click the guard should never have to make.
    expect(screen.queryByTestId('phone-search-results')).toBeNull();
    expect(rpcCalls).not.toContain('lookup_pass');
  });

  it('counts the progress bar and the attention banner off the rows below them', async () => {
    await renderConsole();
    search('RGP-OUT-20260818-0481');

    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    expect(screen.getByText('1 of 2 items returned')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('Dell Precision Laptop 5570')).toBeInTheDocument();
    expect(screen.getByText('Bosch Cordless Drill')).toBeInTheDocument();
    expect(screen.getByText('IT-LTP-0842')).toBeInTheDocument();
    expect(
      screen.getByText('1 item still needs attention before this pass can be closed')
    ).toBeInTheDocument();
    // The open line offers the only action that can actually close it.
    expect(screen.getByRole('link', { name: /mark return — bosch cordless drill/i })).toBeInTheDocument();
  });

  it('shows the return activity newest first', async () => {
    await renderConsole();
    search('RGP-OUT-20260818-0481');

    await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
    const entries = screen.getAllByText(/Material marked returned|Cleared out at the gate/);
    expect(entries[0].textContent).toBe('Material marked returned');
    expect(entries[1].textContent).toBe('Cleared out at the gate');
  });
});
