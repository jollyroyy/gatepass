// Per-item returns at the gate (migration 029).
//
// A trolley goes out with a drill, two ladders and a coil of cable. They do not
// come back together. Before this, the guard's only action was Mark Returned,
// which closes every line at once — so a partial return could only be recorded
// as a lie in one direction or the other.
//
// The backend has supported this since 013 (`apply_item_returns` takes
// [{item_id, qty}] and rolls the lines up); nothing ever called it. This is
// that caller.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { GatePassItemView } from '../../src/types';

const rpc = vi.fn();
const selectRows: { current: GatePassItemView[] } = { current: [] };

function thenable(result: { data: unknown; error: unknown }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {
    then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(ok, bad),
  };
  for (const m of ['select', 'eq', 'order', 'in', 'limit']) obj[m] = () => thenable(result);
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({
    from: () => thenable({ data: selectRows.current, error: null }),
    rpc: (...args: unknown[]) => {
      rpc(...args);
      return Promise.resolve({ data: null, error: null });
    },
  }),
  pub: () => ({ from: () => thenable({ data: [], error: null }) }),
}));

import ItemReturnList from '../../src/pages/Security/ItemReturnList';

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1',
    gate_pass_id: 'p1',
    line_no: 1,
    name: 'Drill Machine',
    description: 'Bosch GSB 13mm',
    purpose: 'Repair work',
    expected_return_date: '2026-08-20',
    quantity: 1,
    unit: 'nos',
    serial_no: null,
    approx_value: null,
    returned_qty: 0,
    returned_at: null,
    department_id: 'd1',
    is_open: true,
    created_at: '2026-08-08T04:00:00.000Z',
    outstanding_qty: 1,
    pass_number: 'RGP-OUT-20260808-0001',
    pass_status: 'matched',
    return_status: 'awaiting_return',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const THREE_LINES: GatePassItemView[] = [
  item({ id: 'i1', line_no: 1, name: 'Drill Machine', quantity: 1, returned_qty: 0, outstanding_qty: 1 }),
  item({ id: 'i2', line_no: 2, name: 'Ladder', quantity: 2, returned_qty: 0, outstanding_qty: 2 }),
  item({
    id: 'i3', line_no: 3, name: 'Cable Coil', quantity: 1,
    returned_qty: 1, outstanding_qty: 0,
    returned_at: '2026-08-08T06:30:00.000Z',
  }),
];

beforeEach(() => {
  rpc.mockClear();
  selectRows.current = THREE_LINES;
});

describe('ItemReturnList — every line is listed with its own state', () => {
  it('lists each item on the pass', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Drill Machine')).toBeTruthy());
    expect(screen.getByText('Ladder')).toBeTruthy();
    expect(screen.getByText('Cable Coil')).toBeTruthy();
  });

  it('shows the return date AND time for a line already returned', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    // The guard needs the clock time, not just the date: two returns on the
    // same day are otherwise indistinguishable in the record.
    const stamp = await screen.findByTestId('returned-at-i3');
    expect(stamp.textContent).toMatch(/\d{1,2}:\d{2}/);
    expect(stamp.textContent).toMatch(/2026|Aug/i);
  });

  it('shows no return stamp for a line still outstanding', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Drill Machine')).toBeTruthy());
    expect(screen.queryByTestId('returned-at-i1')).toBeNull();
    expect(screen.queryByTestId('returned-at-i2')).toBeNull();
  });

  it('offers a return button only on lines that still owe material', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Drill Machine')).toBeTruthy());
    expect(screen.getByTestId('return-item-i1')).toBeTruthy();
    expect(screen.getByTestId('return-item-i2')).toBeTruthy();
    // Already fully back — offering it again would let a guard double-record.
    expect(screen.queryByTestId('return-item-i3')).toBeNull();
  });
});

describe('ItemReturnList — marking one line returned', () => {
  it('calls apply_item_returns with ONLY that line and its outstanding quantity', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('return-item-i2')).toBeTruthy());
    fireEvent.click(screen.getByTestId('return-item-i2'));

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('apply_item_returns');
    expect(args.p_pass_id).toBe('p1');
    // The whole outstanding quantity of that one line — 2 ladders, not 1, and
    // nothing from the drill.
    expect(args.p_lines).toEqual([{ item_id: 'i2', qty: 2 }]);
  });

  it('never sends a line the guard did not act on', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('return-item-i1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('return-item-i1'));

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect((args.p_lines as unknown[]).length).toBe(1);
  });

  it('tells the parent, so the pass auto-closes in the UI when the last line lands', async () => {
    // The DATABASE closes the pass (apply_item_returns rolls the lines up). The
    // callback exists so the dashboard re-reads that decision — the client must
    // never decide closure for itself.
    const onReturned = vi.fn();
    render(<ItemReturnList passId="p1" onReturned={onReturned} />);
    await waitFor(() => expect(screen.getByTestId('return-item-i1')).toBeTruthy());
    fireEvent.click(screen.getByTestId('return-item-i1'));
    await waitFor(() => expect(onReturned).toHaveBeenCalled());
  });
});

describe('ItemReturnList — a fully returned pass', () => {
  it('shows every line stamped and offers no further action', async () => {
    selectRows.current = [
      item({ id: 'i1', quantity: 1, returned_qty: 1, outstanding_qty: 0,
             returned_at: '2026-08-08T06:00:00.000Z', return_status: 'returned' }),
    ];
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('returned-at-i1')).toBeTruthy());
    expect(screen.queryByTestId('return-item-i1')).toBeNull();
  });
});
