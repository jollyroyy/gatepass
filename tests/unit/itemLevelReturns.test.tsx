// Item-level, micro-quantity returns on the Pending RGP Return page
// (client mock-up, 2026-08-19) — staging a return line by line inside
// `AddReturnBox` / `PendingReturnItems` / `PendingReturnRow`, and committing
// every staged line in ONE `apply_item_returns` call from the Record bar.
//
// Mocking pattern copied from `tests/unit/pendingReturnsPage.test.tsx`
// (the `builder(table)` thenable, the `gp()`/`pub()`/`supabase` mock, the
// `ch` channel stub, the `pass()` factory) and extended so `v_gate_pass_items`
// answers with real rows and `rpc` records every call it receives.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';

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

function item(over: Partial<GatePassItemView>): GatePassItemView {
  const quantity = over.quantity ?? 1;
  const returned_qty = over.returned_qty ?? 0;
  return {
    id: 'i0', gate_pass_id: 'p1', line_no: 1, name: 'Item', description: '', purpose: '',
    expected_return_date: null, quantity, unit: 'nos', serial_no: null, approx_value: null,
    returned_qty, returned_at: null, department_id: 'd1', is_open: true,
    created_at: '2026-08-01T00:00:00Z',
    outstanding_qty: quantity - returned_qty,
    pass_number: 'RGP-20260810-0007', pass_status: 'matched', return_status: 'partially_returned',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// The client's own example: a partly-returned, overdue RGP with two lines
// whose units DISAGREE (litre vs kg), which is what exercises the per-cell
// unit path in `src/lib/units.ts` rather than the shared-heading one. A third,
// fully-returned line ("Cement Bags") is included for the "already back"
// case — its unit disagrees with both too, so `headingUnit` stays null and
// every row must carry its own unit label.
let OPEN_RETURNS: GatePassView[] = [];
let ITEMS: GatePassItemView[] = [];
let PHONE_ROWS: GatePassView[] = [];
let RPC_CALLS: { name: string; args: unknown }[] = [];

function resetRows(): void {
  PHONE_ROWS = [];
  RPC_CALLS = [];
  OPEN_RETURNS = [
    pass({
      id: 'p1', pass_number: 'RGP-20260810-0007',
      return_status: 'partially_returned', due_state: 'overdue', is_overdue: true,
      expected_return_date: '2026-08-10', material_summary: 'Diesel, Steel Rods',
      item_count: 2, total_quantity: 2250, returned_quantity: 1000,
    }),
  ];
  ITEMS = [
    item({
      id: 'diesel', gate_pass_id: 'p1', line_no: 1, name: 'Diesel', description: 'Fuel',
      quantity: 1000, unit: 'litre', returned_qty: 0,
    }),
    item({
      id: 'steel', gate_pass_id: 'p1', line_no: 2, name: 'Steel Rods', description: 'MS rods',
      quantity: 1250, unit: 'kg', returned_qty: 1000,
    }),
    item({
      id: 'cement', gate_pass_id: 'p1', line_no: 3, name: 'Cement Bags', description: 'OPC 43',
      quantity: 500, unit: 'nos', returned_qty: 500,
    }),
  ];
}

function builder(table: string) {
  let phone = false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'limit', 'lte', 'lt', 'gte', 'eq', 'in']) obj[m] = () => obj;
  obj.ilike = () => { phone = true; return obj; };
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    const data = table === 'v_gate_pass_items' ? ITEMS : phone ? PHONE_ROWS : OPEN_RETURNS;
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
    rpc: (name: string, args: unknown) => {
      RPC_CALLS.push({ name, args });
      return Promise.resolve({ data: [{ outcome: 'ok', pass_id: 'far1', blacklist_match: null }], error: null });
    },
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
  await waitFor(() => expect(screen.getByText('RGP-20260810-0007')).toBeInTheDocument());
}

async function openRow(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Verify \/ Update Return/ }));
  await waitFor(() => expect(screen.getByText(/Items in this Pass/)).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Diesel')).toBeInTheDocument());
}

function openBoxOn(itemName: string): void {
  fireEvent.click(screen.getByRole('button', { name: `Add return for ${itemName}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRows();
});

describe('Item-level returns', () => {
  it('opening the row shows the material lines and an Add Return button per line still owed', async () => {
    // Catches: the row's disclosure not wiring `usePassItems`, or the panel
    // rendering something other than the pass's own lines.
    await renderPage();
    await openRow();
    expect(screen.getByText('Diesel')).toBeInTheDocument();
    expect(screen.getByText('Steel Rods')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add return for Diesel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add return for Steel Rods' })).toBeInTheDocument();
  });

  it('a micro, partial return is staged but not sent — no rpc call yet, and the line reads partial', async () => {
    // Catches: `AddReturnBox` committing on Confirm instead of only staging
    // via `stageLine`, and `effectiveReturned`/`lineStateLabel` not folding
    // the staged quantity into the line's own state.
    await renderPage();
    await openRow();
    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Remarks (optional)'), { target: { value: 'partial load' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit return for Diesel' })).toBeInTheDocument());
    expect(RPC_CALLS).toHaveLength(0);
    expect(screen.getByText('Staged 800')).toBeInTheDocument();
    expect(screen.getByText('Partial (200 Litre Pending)')).toBeInTheDocument();
  });

  it('the Record press commits exactly one call carrying the staged line and a remark naming it', async () => {
    // Catches: `recordDraftedReturns` sending more than one RPC call, or
    // `draftPayload`/`draftRemarks` losing the item id, quantity or the
    // guard's own remark text.
    await renderPage();
    await openRow();
    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Remarks (optional)'), { target: { value: 'returned by driver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Record 1 Return' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Record 1 Return' }));

    await waitFor(() => expect(RPC_CALLS).toHaveLength(1));
    const call = RPC_CALLS[0];
    expect(call.name).toBe('apply_item_returns');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = call.args as any;
    expect(args.p_pass_id).toBe('p1');
    expect(args.p_lines).toEqual([{ item_id: 'diesel', qty: 800 }]);
    expect(args.p_remarks).toContain('Diesel');
    expect(args.p_remarks).toContain('800');
    expect(args.p_remarks).toContain('returned by driver');
  });

  it('two staged lines commit in one call, in item order', async () => {
    // Catches: the Record bar firing one RPC call per staged line instead of
    // batching, or `draftPayload` not preserving the lines' own order.
    await renderPage();
    await openRow();

    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Add return for Steel Rods' })).toBeInTheDocument());

    openBoxOn('Steel Rods');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Record 2 Returns' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Record 2 Returns' }));

    await waitFor(() => expect(RPC_CALLS).toHaveLength(1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = RPC_CALLS[0].args as any;
    expect(args.p_lines).toEqual([
      { item_id: 'diesel', qty: 800 },
      { item_id: 'steel', qty: 250 },
    ]);
  });

  it('the ceiling is the line’s own outstanding quantity, not its total', async () => {
    // Catches: `checkReturnQty` capping against `quantity` instead of
    // `outstanding_qty` — Steel Rods has 1250 ordered but only 250 left after
    // 1000 already came back.
    await renderPage();
    await openRow();
    openBoxOn('Steel Rods');

    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));

    expect(await screen.findByText(/Only 250 is still outstanding on this line\./)).toBeInTheDocument();
    // Stages nothing, and the box is still open.
    expect(screen.getByLabelText('Return Now*')).toBeInTheDocument();
    expect(screen.queryByText(/staged and not yet recorded/)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Edit return for Steel Rods' })).toBeInTheDocument());
  });

  it('zero and a blank quantity are both refused and stage nothing', async () => {
    // Catches: `checkReturnQty` treating `Number('')` as 0 and letting a
    // zero-quantity return through, per its own comment.
    await renderPage();
    await openRow();
    openBoxOn('Diesel');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    expect(await screen.findByText('Enter the quantity that came back.')).toBeInTheDocument();
    expect(screen.getByLabelText('Return Now*')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    expect(await screen.findByText('A return must be more than zero.')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Add return for Diesel' })).toBeInTheDocument();
    expect(RPC_CALLS).toHaveLength(0);
  });

  it('Cancel throws the entry away — the box closes and nothing is staged', async () => {
    // Catches: `onCancel` accidentally staging the line, or the Record bar
    // appearing for a cancelled entry.
    await renderPage();
    await openRow();
    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByLabelText('Return Now*')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add return for Diesel' })).toBeInTheDocument();
    expect(screen.queryByText(/staged and not yet recorded/)).not.toBeInTheDocument();
  });

  it('Discard on the Record bar clears every staged line without ever calling the rpc', async () => {
    // Catches: Discard leaving stale entries in `draft`, or silently touching
    // the database instead of only clearing local state.
    await renderPage();
    await openRow();
    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.queryByText(/staged and not yet recorded/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Add return for Diesel' })).toBeInTheDocument();
    expect(RPC_CALLS).toHaveLength(0);
  });

  it('a fully-returned line offers no Add Return button and reads Returned', async () => {
    // Catches: `lineState` grading a fully-back line as anything but
    // `returned`, which would offer a button `apply_item_returns` refuses.
    await renderPage();
    await openRow();
    expect(screen.getByText('Cement Bags')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return for Cement Bags/ })).not.toBeInTheDocument();
    // Scoped to the line's own row: the legend under the table names the same
    // four states, which is what a legend is for.
    const row = screen.getByText('Cement Bags').closest('tr')!;
    expect(within(row).getAllByText('Returned').length).toBeGreaterThan(0);
  });
});
