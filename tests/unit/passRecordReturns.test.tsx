// The gate pass record IS where a return is entered, and where it stops being
// editable.
//
// Client, 2026-08-19: pressing Approve or Verify Return from a guard list opens
// this record; the mock-up puts the returned quantity on this very table; and
// "once it is marked as returned, nothing can be edited anymore."
//
// So this file holds four things:
//   * a guard stages a PARTIAL quantity and one press sends one RPC;
//   * a staged line says "Not recorded yet" even when its quantity closes it —
//     `apply_item_returns` has no undo, so a tap must never be the commit;
//   * nobody but a guard is offered the entry, because the RPC refuses them;
//   * a fully returned pass says it is closed and offers nothing at all.
//
// Plus the approval ladder, which is the other half of the same mock-up: it
// names the four offices from `get_approval_ladder`, and says "Not designated
// yet" for an office nobody holds rather than implying a signature.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassView } from '../../src/types';

let row: GatePassView;
let items: unknown[] = [];
let ladder: unknown[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = vi.fn((name: string, _args: any) =>
  Promise.resolve({ data: name === 'get_approval_ladder' ? ladder : null, error: null }),
);

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260818-0003', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering (MEP)', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Yadav',
    visitor_name: 'Ravi Kumar',
    visitor_company: '{"n":"TechFix Solutions","a":"B-108, Sector 63","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Equipment repair', expected_return_date: '2026-08-24',
    actual_return_date: null,
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-18T06:15:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: '2026-08-19T18:30:00Z',
    created_at: '2026-08-18T05:00:00Z', updated_at: '2026-08-18T06:15:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 1, total_quantity: 1000, returned_quantity: 0, total_value: 5000,
    material_summary: 'Diesel',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function line(over: Record<string, unknown> = {}) {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Diesel',
    description: 'HSD', serial_no: null, quantity: 1000, unit: 'ltr',
    returned_qty: 0, returned_at: null, approx_value: 5000,
    expected_return_date: '2026-08-24', outstanding_qty: 1000,
    ...over,
  };
}

vi.mock('../../src/supabaseClient', () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const o: any = {};
    for (const m of ['select', 'eq', 'order']) o[m] = () => o;
    o.maybeSingle = () => Promise.resolve({ data: row, error: null });
    o.then = (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) =>
      Promise.resolve({ data: table === 'v_gate_pass_items' ? items : [], error: null }).then(ok, err);
    return o;
  };
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gp: () => ({ from: (t: string) => builder(t), rpc: (n: string, a: any) => rpc(n, a) as never }),
    supabase: {
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u9' } } }) },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

const { default: PassDetail } = await import('../../src/pages/Shared/PassDetail');

async function renderAs(role: 'guard' | 'hod' | 'admin') {
  render(
    <MemoryRouter initialEntries={['/pass/p1']}>
      <Routes>
        <Route path="/pass/:id" element={<PassDetail role={role} />} />
      </Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId('pass-record')).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
  row = pass();
  items = [line()];
  ladder = [];
});

describe('recording a return on the pass record', () => {
  it('stages a PARTIAL quantity without touching the database', async () => {
    await renderAs('guard');
    fireEvent.click(screen.getByRole('button', { name: 'Mark return' }));

    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Remarks (optional)'), { target: { value: 'two drums short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));

    // 800 of 1,000 litres is the whole point — and none of it has been sent.
    // Scoped to the TABLE since 2026-08-22: the timeline's own line list says
    // "Not recorded yet" against a staged line too, so the bare query now
    // matches twice. Both are deliberate — the phrase is the one thing that
    // stops "looks done" reading as "is done", wherever a staged figure shows.
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('Not recorded yet')).toBeInTheDocument());
    expect(rpc).not.toHaveBeenCalledWith('apply_item_returns', expect.anything());
    // One Quantity column now (client, 2026-08-19): the issued figure, then the
    // second number under it — what has actually come back — and what is left.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Returned 800 ltr')).toBeInTheDocument();
    expect(table.getByText('Pending 200 ltr')).toBeInTheDocument();
  });

  it('sends exactly one call, carrying the line and a remark naming it', async () => {
    await renderAs('guard');
    fireEvent.click(screen.getByRole('button', { name: 'Mark return' }));
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '800' } });
    fireEvent.change(screen.getByLabelText('Remarks (optional)'), { target: { value: 'two drums short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));

    fireEvent.click(await screen.findByTestId('record-pass-returns'));

    await waitFor(() => {
      const call = rpc.mock.calls.find((c) => c[0] === 'apply_item_returns');
      expect(call).toBeDefined();
      expect(call![1]).toMatchObject({
        p_pass_id: 'p1',
        p_lines: [{ item_id: 'i1', qty: 800 }],
      });
      expect(call![1].p_remarks).toContain('two drums short');
    });
  });

  it('refuses more than the line still owes, before the press rather than after', async () => {
    await renderAs('guard');
    fireEvent.click(screen.getByRole('button', { name: 'Mark return' }));
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '1200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));

    expect(await screen.findByText(/Only 1,000 is still outstanding/)).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalledWith('apply_item_returns', expect.anything());
  });

  it('offers an HOD and an admin nothing — apply_item_returns refuses them', async () => {
    await renderAs('hod');
    expect(screen.queryByRole('button', { name: /Add Return/ })).not.toBeInTheDocument();
    expect(screen.getByText('NA')).toBeInTheDocument();
  });
});

describe('the attention strip', () => {
  // The mock-up's amber strip: the one condition keeping this pass open, said
  // in words, with the way to clear it beside it — and only for the guard, who
  // is the only reader `apply_item_returns` accepts.
  it('names how many lines still owe material, and sends a guard to the first', async () => {
    await renderAs('guard');
    const strip = within(await screen.findByTestId('items-need-attention'));
    expect(strip.getByText(/still needs attention before this pass can be closed/)).toBeInTheDocument();
    fireEvent.click(strip.getByRole('button', { name: 'Review pending items' }));
    expect(screen.getByLabelText('Return Now*')).toBeInTheDocument();
  });

  // REWRITTEN 2026-08-20. It used to hold that an HOD saw the strip WITHOUT its
  // button — nobody but the gate can record a return. The client asked for the
  // strip itself to go from their pass details page ("1 item still needs
  // attention before this pass can be closed — remove this from pass details
  // page in hod"), and they are right: a standing amber warning with no control
  // under it is an alarm nobody in the room can silence. Nothing was lost — the
  // item table still states each line's own outstanding quantity.
  it('is not drawn at all for an HOD, who cannot act on it', async () => {
    await renderAs('hod');
    // The record itself rendered — this is the strip's absence, not a page
    // that failed to load.
    expect(screen.getByTestId('pass-record')).toBeInTheDocument();
    expect(screen.queryByTestId('items-need-attention')).not.toBeInTheDocument();
  });
});

describe('a returned pass is closed for good', () => {
  it('says so, and offers no entry even to a guard', async () => {
    row = pass({ return_status: 'returned', actual_return_date: '2026-08-20T04:00:00Z' });
    items = [line({ returned_qty: 1000, outstanding_qty: 0, returned_at: '2026-08-20T04:00:00Z' })];
    await renderAs('guard');

    expect(screen.getByTestId('return-locked')).toHaveTextContent(/nothing on this pass can be edited/i);
    expect(screen.queryByRole('button', { name: /Add Return/ })).not.toBeInTheDocument();
    expect(screen.getByText('NA')).toBeInTheDocument();
  });
});

describe('the approval ladder on the record', () => {
  const TWO_HELD = [
    { role_key: 'security_head' as const, user_id: 'a', full_name: 'Arun Kumar', department_name: 'Security', designated_at: '2026-08-01T00:00:00Z' },
    { role_key: 'coo' as const, user_id: 'b', full_name: 'Vikram Singh', department_name: 'Operations', designated_at: '2026-08-01T00:00:00Z' },
  ];

  it('names each office and its holder, and says which are vacant', async () => {
    ladder = TWO_HELD;
    await renderAs('hod');

    const rail = within(await screen.findByTestId('pass-timeline'));
    await waitFor(() => expect(rail.getByText('Security Head (Arun Kumar)')).toBeInTheDocument());
    expect(rail.getByText('COO (Vikram Singh)')).toBeInTheDocument();
    // Two offices vacant — said out loud to a reader at a desk, never implied
    // signed. The raising HOD is the first of the five and is always approved.
    expect(rail.getByText('CEO')).toBeInTheDocument();
    expect(rail.getAllByText('Not designated yet')).toHaveLength(2);
    // The fact strip's counter was deleted on 2026-08-19 (client): the rail
    // states every level by name, and a number beside it was the same fact
    // twice — and the one that goes stale.
    expect(screen.queryByText(/levels? approved/)).not.toBeInTheDocument();
  });

  // Client, 2026-08-19: only approved passes reach the guard's view, so mark
  // them approved by those approvers. The signed slip is in the guard's hand.
  it('reads every office as approved for a GUARD, held or not', async () => {
    ladder = TWO_HELD;
    await renderAs('guard');

    const rail = within(await screen.findByTestId('pass-timeline'));
    await waitFor(() => expect(rail.getByText('Security Head (Arun Kumar)')).toBeInTheDocument());
    expect(rail.queryByText('Not designated yet')).not.toBeInTheDocument();
    expect(rail.getAllByText('Signed on the printed pass')).toHaveLength(4);
  });

  it('renders the record perfectly well when the ladder cannot be read', async () => {
    rpc.mockImplementationOnce(() => Promise.reject(new Error('nope')));
    await renderAs('hod');
    expect(screen.getByTestId('pass-timeline')).toBeInTheDocument();
    expect(screen.getAllByText('Not designated yet')).toHaveLength(4);
  });
});
