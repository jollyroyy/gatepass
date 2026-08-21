// "Items in this gate pass" — the table drawn to the client's latest mock-up
// (2026-08-19).
//
// Four client instructions are pinned here:
//   * "The column heading should be Quantity and under that the values would be
//     3 L or 3 kg as per the item" — one column, the unit in the cell, and the
//     second number (what actually came back) under the first.
//   * "Put the serial number against all the items, in both the passes."
//   * the return status carries the date and time the system stamped, never a
//     typed one, and it is final.
//   * "N items still need attention before this pass can be closed."
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { GatePassItemView, GatePassView } from '../../src/types';
import { pendingItemCount } from '../../src/lib/passRecordView';
import PassRecordItems from '../../src/components/passview/PassRecordItems';
import { EMPTY_DRAFT } from '../../src/lib/returnDraft';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    // `status` is part of the fixture since 2026-08-21: a line's badge repeats
    // the PASS's own badge unless the line has a return of its own, so the pass
    // must actually have a status for the table to render.
    id: 'p1', pass_number: 'RGP-20260818-0003', type: 'RGP', status: 'matched',
    return_status: 'awaiting_return', is_expired: false, is_overdue: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function line(over: Record<string, unknown> = {}): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Diesel', description: 'HSD',
    serial_no: null, quantity: 3, unit: 'litre', returned_qty: 0, returned_at: null,
    approx_value: 500, expected_return_date: '2026-08-24', outstanding_qty: 3,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function draw(p: GatePassView, items: GatePassItemView[], canRecord = false) {
  return render(
    <PassRecordItems pass={p} items={items} draft={EMPTY_DRAFT} canRecord={canRecord} onAdd={vi.fn()} />,
  );
}

describe('the Quantity column', () => {
  it('is ONE column that names each line\'s own unit', () => {
    draw(pass(), [line(), line({ id: 'i2', name: 'Bolts', unit: 'nos', quantity: 12 })]);

    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toContain('Quantity');
    // The old separate columns are gone — the unit is in the cell now.
    expect(heads).not.toContain('Unit');
    expect(heads).not.toContain('Qty Returned');
    expect(heads).not.toContain('Pending Qty');

    expect(screen.getByText('3 Litre')).toBeInTheDocument();
    // `nos` is still never spelled out — a count of 12 is "12".
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('prints the second number — what actually came back — under the first', () => {
    draw(pass(), [line({ returned_qty: 2, outstanding_qty: 1 })]);
    expect(screen.getByText('Returned 2 Litre')).toBeInTheDocument();
    expect(screen.getByText('Pending 1 Litre')).toBeInTheDocument();
  });

  it('says nothing about returns on a line nothing has come back on', () => {
    draw(pass(), [line()]);
    expect(screen.queryByText(/^Returned /)).not.toBeInTheDocument();
  });
});

describe('Serial / ID', () => {
  it('is a column on an RGP and on an NRGP alike, carrying what was recorded', () => {
    draw(pass(), [line({ serial_no: 'IT-LTP-0842' })]);
    expect(screen.getByText('IT-LTP-0842')).toBeInTheDocument();

    screen.getAllByRole('columnheader');
    render(
      <PassRecordItems
        pass={pass({ type: 'NRGP', return_status: 'not_applicable' })}
        items={[line({ id: 'n1', serial_no: 'TL-DRL-2198' })]}
        draft={EMPTY_DRAFT}
        canRecord={false}
      />,
    );
    expect(screen.getByText('TL-DRL-2198')).toBeInTheDocument();
  });

  it('leaves the cell empty when no serial was recorded — never an em dash', () => {
    const { container } = draw(pass(), [line({ serial_no: null })]);
    expect(container.textContent).not.toContain('—');
  });
});

describe('the return status', () => {
  it('carries the system-stamped date and time of a fully returned line', () => {
    draw(pass(), [line({ returned_qty: 3, outstanding_qty: 0, returned_at: '2026-08-18T10:50:00Z' })]);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('Returned')).toBeInTheDocument();
    // The exact wording is formatDateTime's; what matters is that a moment is
    // printed at all and that it came from the row, not from a guard's typing.
    expect(within(row).getByText(/2026/)).toBeInTheDocument();
  });

  it('shows no date on a partly returned line — 029 stamps one only when it closes', () => {
    draw(pass(), [line({ returned_qty: 1, outstanding_qty: 2, returned_at: null })]);
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('Partially Returned')).toBeInTheDocument();
    expect(within(row).queryByText(/2026/)).not.toBeInTheDocument();
  });

  it('reads Closed on an NRGP, which keeps the column but loses the action', () => {
    render(
      <PassRecordItems
        pass={pass({ type: 'NRGP', return_status: 'not_applicable' })}
        items={[line()]}
        draft={EMPTY_DRAFT}
        canRecord={false}
      />,
    );
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toContain('Status');
    expect(heads).not.toContain('Return Status');
    expect(heads).not.toContain('Action');
    expect(screen.getByText('Closed')).toBeInTheDocument();
  });
});

describe('the progress line', () => {
  it('counts lines fully back, over the table it sits on', () => {
    draw(pass(), [
      line({ returned_qty: 3, outstanding_qty: 0 }),
      line({ id: 'i2', returned_qty: 0 }),
    ]);
    expect(screen.getByText('1 of 2 items returned')).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });
});

describe('pendingItemCount', () => {
  it('counts a partly returned line as still open — the database will not close it either', () => {
    expect(pendingItemCount([line(), line({ id: 'i2', returned_qty: 1 })], 'RGP')).toBe(2);
    expect(pendingItemCount([line({ returned_qty: 3 })], 'RGP')).toBe(0);
  });

  it('is zero for an NRGP, which owes nothing', () => {
    expect(pendingItemCount([line()], 'NRGP')).toBe(0);
  });
});

// THE VALUE COLUMN IS FOOTED (client, 2026-08-19: "put value in all the details
// and the cards … overall the total value also"). The eighth pass deleted the
// old Total row because it summed QUANTITIES across mixed units, which cannot
// be added; rupees can, and the total is the figure a pass is judged on.
describe('the total value', () => {
  it('adds up the priced lines under the Value column', () => {
    draw(pass(), [line(), line({ id: 'i2', name: 'Bolts', approx_value: 1250 })]);
    expect(screen.getByText('Total Value')).toBeInTheDocument();
    expect(screen.getByTestId('items-total-value')).toHaveTextContent('₹1,750');
  });

  it('foots an NRGP the same way', () => {
    draw(pass({ type: 'NRGP', return_status: 'not_applicable' }), [line({ approx_value: 400 })]);
    expect(screen.getByTestId('items-total-value')).toHaveTextContent('₹400');
  });

  it('draws no total at all when not one line carries a value', () => {
    draw(pass(), [line({ approx_value: null })]);
    expect(screen.queryByTestId('items-total-value')).not.toBeInTheDocument();
  });
});
