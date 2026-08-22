// THE TIMELINE NAMES EVERY MATERIAL LINE AND HOW FAR IT HAS COME BACK
// (client, 2026-08-22).
//
// An RGP that is half returned used to say so once, on one rung: "To Be
// Returned — Partially returned". Which lines, and how much of each, was a
// fact only the table on the other side of the screen carried. The rail now
// carries a short entry per line — "Partially Returned (3/8)" — and it moves
// AS THE GUARD TYPES, before anything is recorded, because it reads the same
// draft-inclusive quantities the table does.
//
// It is on the record, so it is on EVERY view: the guard's, the HOD's and the
// admin's are one component. Only the guard can change the numbers.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';
import {
  buildReturnTimeline, outstandingLineNote, shortReturnNote,
} from '../../src/lib/returnTimeline';

let row: GatePassView;
let items: unknown[] = [];

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260818-0003', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'partially_returned',
    department_id: 'd1', department_name: 'Engineering (MEP)', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Yadav',
    visitor_name: 'Ravi Kumar',
    visitor_company: '{"n":"TechFix Solutions","a":"B-108","v":"9876543210"}',
    vehicle_number: 'KA01AB1234',
    purpose: 'Equipment repair', expected_return_date: '2026-08-24',
    actual_return_date: null,
    verified_by: 'g1', verified_by_name: 'Guard One', verified_at: '2026-08-18T06:15:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: '2099-08-19T18:30:00Z',
    created_at: '2026-08-18T05:00:00Z', updated_at: '2026-08-18T06:15:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 2, total_quantity: 10, returned_quantity: 3, total_value: 5000,
    material_summary: 'Headsets',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function line(over: Record<string, unknown> = {}): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Headset',
    description: 'Sony', serial_no: null, quantity: 8, unit: 'nos',
    returned_qty: 3, returned_at: null, approx_value: 5000,
    expected_return_date: '2026-08-24', outstanding_qty: 5,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
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
    gp: () => ({ from: (t: string) => builder(t), rpc: () => Promise.resolve({ data: [], error: null }) }),
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
  row = pass();
  items = [line(), line({ id: 'i2', line_no: 2, name: 'Cable', quantity: 2, returned_qty: 2, outstanding_qty: 0 })];
});

describe('buildReturnTimeline', () => {
  it('states each line as a state and two numbers, counting QUANTITY', () => {
    const lines = buildReturnTimeline(
      [line(), line({ id: 'i2', line_no: 2, name: 'Cable', quantity: 2, returned_qty: 2 })],
      pass(),
    );
    expect(lines.map((l) => l.short)).toEqual([
      'Partially Returned (3/8)',
      'Returned (2/2)',
    ]);
    expect(lines.map((l) => l.staged)).toEqual([false, false]);
  });

  it('includes a STAGED quantity, and says the line is staged', () => {
    const [first] = buildReturnTimeline([line()], pass(), { i1: { qty: 2, remarks: '' } });
    expect(first.short).toBe('Partially Returned (5/8)');
    expect(first.staged).toBe(true);
  });

  it('reads Returned once the staged quantity closes the line', () => {
    const [first] = buildReturnTimeline([line()], pass(), { i1: { qty: 5, remarks: '' } });
    expect(first.short).toBe('Returned (8/8)');
  });

  it('says Not Returned, never a blank, on a line nothing has come back on', () => {
    const [first] = buildReturnTimeline([line({ returned_qty: 0 })], pass());
    expect(first.short).toBe('Not Returned (0/8)');
    expect(first.state).toBe('pending');
  });

  it('draws nothing for an NRGP or for a pass that was refused', () => {
    expect(buildReturnTimeline([line()], pass({ type: 'NRGP' }))).toEqual([]);
    expect(buildReturnTimeline([line()], pass({ status: 'flagged' }))).toEqual([]);
    expect(buildReturnTimeline([line()], pass({ status: 'cancelled' }))).toEqual([]);
  });

  it('never reads past the issued quantity', () => {
    const [first] = buildReturnTimeline([line({ quantity: 8, returned_qty: 9 })], pass());
    expect(first.short).toBe('Returned (8/8)');
  });

  it('counts the lines still out, and says nothing once none are', () => {
    const open = buildReturnTimeline([line(), line({ id: 'i2', quantity: 2, returned_qty: 2 })], pass());
    expect(outstandingLineNote(open)).toBe('1 of 2 lines still out');
    expect(outstandingLineNote(open.slice(1))).toBeNull();
  });

  it('formats the note in this app own words, grouped en-IN', () => {
    expect(shortReturnNote('partial', 1250, 2000)).toBe('Partially Returned (1,250/2,000)');
  });
});

describe('the timeline on the record', () => {
  it('names every line under the return rung, for an HOD as well as a guard', async () => {
    await renderAs('hod');
    const rail = within(screen.getByTestId('pass-timeline'));
    const list = within(rail.getByTestId('timeline-return-lines'));
    expect(list.getByText('1. Headset')).toBeInTheDocument();
    expect(list.getByText('Partially Returned (3/8)')).toBeInTheDocument();
    expect(list.getByText('2. Cable')).toBeInTheDocument();
    expect(list.getByText('Returned (2/2)')).toBeInTheDocument();
    expect(rail.getByText('1 of 2 lines still out')).toBeInTheDocument();
  });

  it('MOVES AS THE GUARD TYPES, before anything is recorded', async () => {
    await renderAs('guard');
    const railBefore = within(screen.getByTestId('timeline-return-lines'));
    expect(railBefore.getByText('Partially Returned (3/8)')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Mark return' })[0]);
    fireEvent.change(screen.getByLabelText('Return Now*'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Return' }));

    await waitFor(() => {
      const rail = within(screen.getByTestId('timeline-return-lines'));
      expect(rail.getByText('Partially Returned (5/8)')).toBeInTheDocument();
    });
    // Staged is not recorded, and the rail says so rather than reading as done.
    expect(within(screen.getByTestId('timeline-return-lines')).getByText('Not recorded yet'))
      .toBeInTheDocument();
  });

  it('carries no line list on an NRGP', async () => {
    row = pass({ type: 'NRGP', return_status: 'not_applicable' });
    await renderAs('admin');
    expect(screen.queryByTestId('timeline-return-lines')).not.toBeInTheDocument();
  });
});
