// Per-item returns at the gate (migration 029), driven by TICK BOXES.
//
// A trolley goes out with a drill, two ladders and a coil of cable. They do not
// come back together. Before 029 the guard's only action was Mark Returned,
// which closes every line at once — so a partial return could only be recorded
// as a lie in one direction or the other.
//
// 2026-08-17, client's call: the per-line "Mark Returned" BUTTON is replaced by
// a checkbox per line plus one submit. A button committed the moment it was
// pressed, which at a barrier means a mis-tap is permanent — `apply_item_returns`
// only ever ADDS to `returned_qty` (a qty <= 0 is skipped outright), so there is
// no undo in the database. A tick box is a decision the guard can take back
// until they press Record; that is the whole point of the change.
//
// Consequence pinned below: a line ALREADY recorded returned shows a checked,
// DISABLED box. Un-ticking it would have to decrement `returned_qty` and clear
// `returned_at`, which no RPC does — a control that always failed would be
// worse than none.
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

function tick(id: string): HTMLInputElement {
  return screen.getByTestId(`tick-item-${id}`) as HTMLInputElement;
}

beforeEach(() => {
  rpc.mockClear();
  selectRows.current = THREE_LINES;
});

describe('ItemReturnList — every line is listed with its own tick box and state', () => {
  it('lists each item on the pass', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Drill Machine')).toBeTruthy());
    expect(screen.getByText('Ladder')).toBeTruthy();
    expect(screen.getByText('Cable Coil')).toBeTruthy();
  });

  it('gives every line a tick box, including one already back', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(tick('i1')).toBeTruthy());
    expect(tick('i2')).toBeTruthy();
    expect(tick('i3')).toBeTruthy();
  });

  it('starts an outstanding line unticked and reading Pending', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(tick('i1')).toBeTruthy());
    expect(tick('i1').checked).toBe(false);
    expect(screen.getByTestId('item-state-i1').textContent).toMatch(/pending/i);
  });

  it('shows a line already recorded as checked, disabled and Returned', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(tick('i3')).toBeTruthy());
    expect(tick('i3').checked).toBe(true);
    // No undo exists in the database — see the file header.
    expect(tick('i3').disabled).toBe(true);
    expect(screen.getByTestId('item-state-i3').textContent).toMatch(/returned/i);
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
});

describe('ItemReturnList — ticking is a decision the guard can take back', () => {
  it('records nothing when a box is ticked — only the state text moves', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(tick('i2')).toBeTruthy());
    fireEvent.click(tick('i2'));

    expect(tick('i2').checked).toBe(true);
    expect(screen.getByTestId('item-state-i2').textContent).toMatch(/marked returned/i);
    // The whole reason for the tick box: nothing has reached the database yet.
    expect(rpc).not.toHaveBeenCalled();
  });

  it('un-ticks back to Pending', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(tick('i2')).toBeTruthy());
    fireEvent.click(tick('i2'));
    fireEvent.click(tick('i2'));

    expect(tick('i2').checked).toBe(false);
    expect(screen.getByTestId('item-state-i2').textContent).toMatch(/pending/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('offers no submit until something is ticked', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    const btn = (await screen.findByTestId('record-returns')) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(tick('i1'));
    expect((screen.getByTestId('record-returns') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ticks every outstanding line at once, and never the one already back', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('tick-all')).toBeTruthy());
    fireEvent.click(screen.getByTestId('tick-all'));

    expect(tick('i1').checked).toBe(true);
    expect(tick('i2').checked).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('ItemReturnList — recording the ticked lines', () => {
  it('sends ONLY the ticked lines, each with its full outstanding quantity', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(tick('i2')).toBeTruthy());
    fireEvent.click(tick('i2'));
    fireEvent.click(screen.getByTestId('record-returns'));

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe('apply_item_returns');
    expect(args.p_pass_id).toBe('p1');
    // The whole outstanding quantity of that one line — 2 ladders, not 1, and
    // nothing from the drill the guard did not tick.
    expect(args.p_lines).toEqual([{ item_id: 'i2', qty: 2 }]);
  });

  it('sends both lines in one call when both are ticked', async () => {
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(tick('i1')).toBeTruthy());
    fireEvent.click(tick('i1'));
    fireEvent.click(tick('i2'));
    fireEvent.click(screen.getByTestId('record-returns'));

    await waitFor(() => expect(rpc).toHaveBeenCalled());
    // One RPC, not two: the pass rolls up once, so a two-line return is one
    // event in `verifications` rather than two that look like separate visits.
    expect(rpc).toHaveBeenCalledTimes(1);
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_lines).toEqual([
      { item_id: 'i1', qty: 1 },
      { item_id: 'i2', qty: 2 },
    ]);
  });

  it('tells the parent, so the pass auto-closes in the UI when the last line lands', async () => {
    // The DATABASE closes the pass (apply_item_returns rolls the lines up). The
    // callback exists so the dashboard re-reads that decision — the client must
    // never decide closure for itself.
    const onReturned = vi.fn();
    render(<ItemReturnList passId="p1" onReturned={onReturned} />);
    await waitFor(() => expect(tick('i1')).toBeTruthy());
    fireEvent.click(tick('i1'));
    fireEvent.click(screen.getByTestId('record-returns'));
    await waitFor(() => expect(onReturned).toHaveBeenCalled());
  });
});

describe('ItemReturnList — a fully returned pass', () => {
  it('shows every line stamped and offers no submit at all', async () => {
    selectRows.current = [
      item({ id: 'i1', quantity: 1, returned_qty: 1, outstanding_qty: 0,
             returned_at: '2026-08-08T06:00:00.000Z', return_status: 'returned' }),
    ];
    render(<ItemReturnList passId="p1" onReturned={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('returned-at-i1')).toBeTruthy());
    expect(screen.queryByTestId('record-returns')).toBeNull();
    expect(screen.queryByTestId('tick-all')).toBeNull();
  });
});
