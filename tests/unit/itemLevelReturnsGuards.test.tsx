// Item-level returns on the pass record — the guard rules around staging, not
// the staging-and-commit path itself (see `itemLevelReturns.test.tsx`, split
// out only to keep both files under the repo's 300-line cap).
//
// MOVED HERE (client, 2026-08-24), from the now-deleted `PendingReturnRow` on
// the Pending RGP Return queue — see the sibling file's header for the full
// story of the move. `PassRecordReturns` is the same component either way, so
// this half holds: the ceiling on a partial entry, the zero/blank refusal,
// Cancel throwing an entry away, Discard clearing a staged set, a
// fully-returned line offering no control, and the database-stamped return
// date on a line.
//
// THE LOAD-BEARING INVARIANT IS THE SAME ONE: `apply_item_returns` has NO
// undo — `returned_qty` only ever increases — so every one of these cases is
// about a tap that must NOT reach the database, or a database press that
// must fire exactly once.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { GatePassItemView, GatePassView } from '../../src/types';
import { EMPTY_DRAFT, type ReturnDraft } from '../../src/lib/returnDraft';
import PassRecordReturns from '../../src/components/passview/PassRecordReturns';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260810-0007', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'partially_returned',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Repair', expected_return_date: '2026-08-10', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: '2026-08-11T18:30:00Z', created_at: '2026-08-09T04:50:00Z',
    is_overdue: false, is_expired: false, awaits_approval: false, due_state: 'overdue',
    item_count: 3, total_quantity: 2750, returned_quantity: 1500,
    material_summary: 'Diesel, Steel Rods, Cement Bags',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Record<string, unknown>): GatePassItemView {
  const quantity = (over.quantity as number) ?? 1;
  const returned_qty = (over.returned_qty as number) ?? 0;
  return {
    id: 'i0', gate_pass_id: 'p1', line_no: 1, name: 'Item', description: '', purpose: '',
    expected_return_date: null, quantity, unit: 'nos', serial_no: null, approx_value: null,
    returned_qty, returned_at: null, department_id: 'd1', is_open: true,
    created_at: '2026-08-01T00:00:00Z',
    outstanding_qty: quantity - returned_qty,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// The client's own example: a partly-returned RGP with two open lines whose
// units DISAGREE (litre vs kg), plus a third, fully-returned line ("Cement
// Bags") for the "already back" and "carries its own date" cases.
const PASS = pass();
const ITEMS: GatePassItemView[] = [
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
    returned_at: '2026-08-17T09:15:00Z',
  }),
];

let RPC_CALLS: { name: string; args: unknown }[] = [];

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    rpc: (name: string, args: unknown) => {
      RPC_CALLS.push({ name, args });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function Harness(): React.ReactElement {
  const [draft, setDraft] = React.useState<ReturnDraft>(EMPTY_DRAFT);
  return (
    <PassRecordReturns
      pass={PASS}
      items={ITEMS}
      canRecord
      draft={draft}
      onDraftChange={setDraft}
      onRecorded={() => undefined}
    />
  );
}

function rowFor(itemName: string): HTMLElement {
  return screen.getByText(itemName).closest('tr')!;
}

/** The row's own "Mark return" (first visit) or "Edit return" (re-opening a
 *  staged line) — `PassRecordItems` carries no per-item accessible name, so
 *  the press is scoped to the material line's own row. */
function openBoxOn(itemName: string): void {
  const row = rowFor(itemName);
  const btn = within(row).queryByRole('button', { name: 'Mark return' })
    ?? within(row).getByRole('button', { name: 'Edit return' });
  fireEvent.click(btn);
}

beforeEach(() => {
  vi.clearAllMocks();
  RPC_CALLS = [];
});

describe('Item-level returns on the pass record — guard rules', () => {
  it('the ceiling is the line\'s own outstanding quantity, not its total', async () => {
    // Catches: `checkReturnQty` capping against `quantity` instead of
    // `outstanding_qty` — Steel Rods has 1250 ordered but only 250 left after
    // 1000 already came back.
    render(<Harness />);
    openBoxOn('Steel Rods');

    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));

    expect(await screen.findByText(/Only 250 is still outstanding on this line\./)).toBeInTheDocument();
    // Stages nothing, and the box is still open.
    expect(screen.getByLabelText('Return Now*')).toBeInTheDocument();
    expect(screen.queryByTestId('record-pass-returns')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    // Staging the LAST 250 owed closes the line's own obligation — it no
    // longer "owes" (`itemReturnStage` grades it `returned`), so the row's
    // control becomes Discard rather than Edit, exactly as a genuinely
    // completed line would read, until the Record press makes it real.
    const row = rowFor('Steel Rods');
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Discard' })).toBeInTheDocument());
    expect(within(row).getByText('Not recorded yet')).toBeInTheDocument();
  });

  it('zero and a blank quantity are both refused and stage nothing', async () => {
    // Catches: `checkReturnQty` treating `Number('')` as 0 and letting a
    // zero-quantity return through, per its own comment.
    render(<Harness />);
    openBoxOn('Diesel');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    expect(await screen.findByText('Enter the quantity that came back.')).toBeInTheDocument();
    expect(screen.getByLabelText('Return Now*')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    expect(await screen.findByText('A return must be more than zero.')).toBeInTheDocument();

    expect(within(rowFor('Diesel')).getByRole('button', { name: 'Mark return' })).toBeInTheDocument();
    expect(RPC_CALLS).toHaveLength(0);
  });

  it('Cancel throws the entry away — the box closes and nothing is staged', async () => {
    // Catches: `onCancel` accidentally staging the line, or the Record bar
    // appearing for a cancelled entry.
    render(<Harness />);
    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByLabelText('Return Now*')).not.toBeInTheDocument());
    expect(within(rowFor('Diesel')).getByRole('button', { name: 'Mark return' })).toBeInTheDocument();
    expect(screen.queryByTestId('record-pass-returns')).not.toBeInTheDocument();
  });

  it('Discard on the Record bar clears every staged line without ever calling the rpc', async () => {
    // Catches: Discard leaving stale entries in `draft`, or silently touching
    // the database instead of only clearing local state.
    render(<Harness />);
    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(screen.queryByTestId('record-pass-returns')).not.toBeInTheDocument());
    expect(within(rowFor('Diesel')).getByRole('button', { name: 'Mark return' })).toBeInTheDocument();
    expect(RPC_CALLS).toHaveLength(0);
  });

  it('a fully-returned line offers no return control and reads Returned', async () => {
    // Catches: `itemReturnStage` grading a fully-back line as anything but
    // `returned`, which would offer a control `apply_item_returns` refuses.
    render(<Harness />);
    expect(screen.getByText('Cement Bags')).toBeInTheDocument();
    const row = rowFor('Cement Bags');
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
    expect(within(row).getByText('NA')).toBeInTheDocument();
    expect(within(row).getByText('Returned')).toBeInTheDocument();
  });

  it('names the DATE a line came back, on the line itself', async () => {
    // Client, 2026-08-19: "whichever item has returned, mention returned on
    // this date". `returned_at` is stamped only once a line is fully back
    // (029), so a line still owing material must carry no date at all rather
    // than borrow the pass's.
    render(<Harness />);
    const done = rowFor('Cement Bags');
    expect(within(done).getByText(/2026/)).toBeInTheDocument();

    const owing = rowFor('Diesel');
    expect(within(owing).queryByText(/2026/)).not.toBeInTheDocument();
  });
});
