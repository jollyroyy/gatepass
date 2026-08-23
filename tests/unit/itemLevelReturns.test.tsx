// Item-level, micro-quantity returns — staged line by line, committed once.
//
// MOVED HERE (client, 2026-08-24). This file used to drive the Pending RGP
// Return queue's own row (`GuardDashboard` → `GuardDrill` → the now-deleted
// `PendingReturnRow`). That queue counts and opens MATERIAL LINES now, through
// `ScheduledReturns`, and the staged-then-committed return entry it used to
// own was never unique to it — client, 2026-08-19, put that entry on the ONE
// gate pass record instead (`/pass/:id`, `PassRecordView`), which is where a
// guard records a return on a pass of ANY date, reached from Search Pass, a
// KPI drill, or the notification bell alike. So this file now drives
// `PassRecordReturns` — the record's own material table plus the box and the
// Record bar underneath it — directly, the same component `PassRecordView`
// renders in its left column. Nothing about the RULE moved: it is still
// `AddReturnBox` (`PassReturnBox` here, its house-themed twin) staging into
// `returnDraft.ts`, and `recordDraftedReturns` sending the whole staged set as
// ONE `apply_item_returns` call.
//
// THIS HALF holds the staging-and-commit path — a line shows, a partial return
// stages without reaching the database, and the Record press commits it (one
// line, then two). See `itemLevelReturnsGuards.test.tsx` for the ceiling, the
// blank/zero refusal, Cancel/Discard, and the fully-returned/date cases, split
// out to keep both files under the repo's 300-line cap.
//
// THE LOAD-BEARING INVARIANT, UNCHANGED: `apply_item_returns` has NO undo —
// `returned_qty` only ever increases — so a tap must never be the commit. A
// guard stages every line with a quantity and a remark; only the Record press
// sends it, as one RPC call carrying every staged line in item order plus a
// remark naming each one.
//
// Mocking pattern: only `gp()` needs a mock, and only for the one RPC this
// component ever calls (`apply_item_returns`) — `PassRecordReturns` holds no
// query of its own, unlike the deleted queue page this file used to render.
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
    item_count: 2, total_quantity: 2250, returned_quantity: 1000,
    material_summary: 'Diesel, Steel Rods',
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

// The client's own example: a partly-returned RGP with two lines whose units
// DISAGREE (litre vs kg). The third, fully-returned line ("Cement Bags")
// belongs to the guard-rules cases and lives in the sibling file instead.
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

describe('Item-level returns on the pass record', () => {
  it('renders every material line, each with an Add Return control while it is still owed', async () => {
    // Catches: the record's table not wiring `onAdd`, or a fully-settled or
    // read-only render swallowing the control on a line that still owes.
    render(<Harness />);
    expect(screen.getByText('Diesel')).toBeInTheDocument();
    expect(screen.getByText('Steel Rods')).toBeInTheDocument();
    expect(within(rowFor('Diesel')).getByRole('button', { name: 'Mark return' })).toBeInTheDocument();
    expect(within(rowFor('Steel Rods')).getByRole('button', { name: 'Mark return' })).toBeInTheDocument();
  });

  it('a micro, partial return is staged but not sent — no rpc call yet, and the line reads partial', async () => {
    // Catches: `PassReturnBox` committing on Confirm instead of only staging
    // via `stageLine`, and `effectiveReturned`/`itemReturnStage` not folding
    // the staged quantity into the line's own state.
    render(<Harness />);
    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Remarks (optional)'), { target: { value: 'partial load' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));

    const row = rowFor('Diesel');
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Edit return' })).toBeInTheDocument());
    expect(RPC_CALLS).toHaveLength(0);
    expect(within(row).getByText('Partially Returned')).toBeInTheDocument();
    expect(within(row).getByText('Returned 800 Litre')).toBeInTheDocument();
    expect(within(row).getByText('Pending 200 Litre')).toBeInTheDocument();
    expect(within(row).getByText('Not recorded yet')).toBeInTheDocument();
  });

  it('the Record press commits exactly one call carrying the staged line and a remark naming it', async () => {
    // Catches: `recordDraftedReturns` sending more than one RPC call, or
    // `draftPayload`/`draftRemarks` losing the item id, quantity or the
    // guard's own remark text.
    render(<Harness />);
    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Remarks (optional)'), { target: { value: 'returned by driver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(screen.getByTestId('record-pass-returns')).toHaveTextContent('Record 1 return'));

    fireEvent.click(screen.getByTestId('record-pass-returns'));

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
    render(<Harness />);

    openBoxOn('Diesel');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(within(rowFor('Steel Rods')).getByRole('button', { name: 'Mark return' })).toBeInTheDocument());

    openBoxOn('Steel Rods');
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));
    await waitFor(() =>
      expect(screen.getByTestId('record-pass-returns')).toHaveTextContent('Record 2 returns'));

    fireEvent.click(screen.getByTestId('record-pass-returns'));

    await waitFor(() => expect(RPC_CALLS).toHaveLength(1));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const args = RPC_CALLS[0].args as any;
    expect(args.p_lines).toEqual([
      { item_id: 'diesel', qty: 800 },
      { item_id: 'steel', qty: 250 },
    ]);
  });
});
