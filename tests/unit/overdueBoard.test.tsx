// Overdue Items, as the three roles see it. One component and ONE scope now —
// the whole backlog, for every role (the guard's day cut was deleted on
// 2026-08-19; it read "0 overdue" while a pass sat late in the return queue).
// Who sees which passes is the page's business, not this component's, and only
// the gate may record a return from it.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applyItemReturns = vi.fn((_name: string, _args: any) => Promise.resolve({ data: null, error: null }));

vi.mock('../../src/supabaseClient', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gp: () => ({ rpc: (name: string, args: any) => applyItemReturns(name, args) as never }),
  supabase: { channel: () => ({ on: () => ({ subscribe: () => undefined }) }), removeChannel: () => undefined },
}));

import OverdueBoard from '../../src/components/overdue/OverdueBoard';

/** Days before today, as a local `YYYY-MM-DD` — the shape of the real column. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-0001', type: 'RGP', direction: 'out', status: 'matched',
    return_status: 'awaiting_return', department_id: 'd1', department_name: 'Engineering',
    visitor_name: 'Rohan Sharma', expected_return_date: daysAgo(1), due_state: 'overdue',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Fluke Multimeter', quantity: 2,
    unit: 'nos', returned_qty: 0, outstanding_qty: 2, expected_return_date: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

// One line a day late, one six days late (critical), one due today (not late).
const PASSES = [
  pass({}),
  pass({ id: 'p2', pass_number: 'RGP-OUT-0002', expected_return_date: daysAgo(6), department_id: 'd2', department_name: 'Housekeeping' }),
  pass({ id: 'p3', pass_number: 'RGP-OUT-0003', expected_return_date: daysAgo(0), due_state: 'due_today' }),
];
const ITEMS = [
  item({}),
  item({ id: 'i2', gate_pass_id: 'p2', name: 'Angle Grinder' }),
  item({ id: 'i3', gate_pass_id: 'p3', name: 'Trolley' }),
];

function renderBoard(props: Partial<React.ComponentProps<typeof OverdueBoard>> = {}) {
  return render(
    <MemoryRouter>
      <OverdueBoard
        subtitle="Overdue material"
        passes={PASSES}
        items={ITEMS}
        canRecord
        loading={false}
        error={null}
        onRecorded={props.onRecorded ?? (() => {})}
        {...props}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('Overdue Items — the figures', () => {
  it('shows Total overdue and nothing else', () => {
    renderBoard();
    const tiles = screen.getByRole('group', { name: 'Overdue figures' });
    expect(within(tiles).getByText('Total overdue').parentElement).toHaveTextContent('2');
    // The other three tiles are gone, not hidden.
    expect(within(tiles).queryByText('Critical overdue')).not.toBeInTheDocument();
    expect(within(tiles).queryByText('Due back today')).not.toBeInTheDocument();
    expect(within(tiles).queryByText('Average delay')).not.toBeInTheDocument();
  });

  it('lists the longest delay first and names each line, never the pass alone', () => {
    renderBoard();
    const rows = within(screen.getByTestId('overdue-table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Angle Grinder');
    expect(rows[0]).toHaveTextContent('6 days');
    expect(rows[1]).toHaveTextContent('Fluke Multimeter');
    expect(rows[1]).toHaveTextContent('1 day');
  });

  it('grades three days or more as Critical, less as Overdue', () => {
    renderBoard();
    const rows = within(screen.getByTestId('overdue-table')).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Critical')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Overdue')).toBeInTheDocument();
  });
});

describe('Overdue Items — scope', () => {
  it('shows every missed date, however old, to every role', () => {
    renderBoard();
    // One day late and six days late, on one page. No day cut for anyone.
    expect(screen.getByText('Fluke Multimeter')).toBeInTheDocument();
    expect(screen.getByText('Angle Grinder')).toBeInTheDocument();
  });

  it('says so plainly when nothing in scope is late', () => {
    renderBoard({ passes: [], items: [] });
    expect(screen.getByText(/Nothing is overdue/i)).toBeInTheDocument();
  });
});

describe('Overdue Items — recording a return', () => {
  it('saves nothing on a tap, and calls apply_item_returns on Record', async () => {
    const onRecorded = vi.fn();
    renderBoard({ onRecorded });

    fireEvent.click(screen.getAllByRole('button', { name: 'Mark returned' })[0]);
    expect(applyItemReturns).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('record-overdue-returns'));
    await waitFor(() => expect(applyItemReturns).toHaveBeenCalled());
    expect(applyItemReturns.mock.calls[0][0]).toBe('apply_item_returns');
    expect(applyItemReturns.mock.calls[0][1].p_pass_id).toBe('p2');
    expect(applyItemReturns.mock.calls[0][1].p_lines).toEqual([{ item_id: 'i2', qty: 2 }]);
    await waitFor(() => expect(onRecorded).toHaveBeenCalled());
  });

  it('offers an HOD and an admin View pass instead — the RPC refuses them anyway', () => {
    renderBoard({ canRecord: false });
    expect(screen.queryByRole('button', { name: 'Mark returned' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'View pass' }).length).toBeGreaterThan(0);
  });
});

describe('Overdue Items — filters and escalation', () => {
  it('narrows by department', () => {
    renderBoard();
    fireEvent.change(screen.getByLabelText('Department'), { target: { value: 'd2' } });
    expect(screen.getByText('Angle Grinder')).toBeInTheDocument();
    expect(screen.queryByText('Fluke Multimeter')).not.toBeInTheDocument();
  });

  it('Review critical items applies the same delay band the badge uses', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /review critical items/i }));
    expect(screen.getByText('Angle Grinder')).toBeInTheDocument();
    expect(screen.queryByText('Fluke Multimeter')).not.toBeInTheDocument();
  });

  it('says when a filter has emptied the table, rather than reading as nothing being late', () => {
    renderBoard();
    fireEvent.change(screen.getByLabelText('Delay'), { target: { value: 'week' } });
    expect(screen.getByText(/No overdue item matches these filters/i)).toBeInTheDocument();
  });
});
