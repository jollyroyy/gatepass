// Client feedback 2026-08-10: "if there are two or multiple materials make
// sure you show the number also, like item number one, item number two...
// currently it is showing only item details but it's not distinguishing
// number 1, number 2, number 3." ItemOrdinal is the shared numbered badge;
// this pins its own suppression rule plus its two real call sites.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ItemOrdinal from '../../src/components/ItemOrdinal';
import type { GatePassItemView } from '../../src/types';

describe('ItemOrdinal', () => {
  it('renders the 1-based position for a multi-item pass', () => {
    render(<ItemOrdinal index={2} total={3} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByLabelText('Item 2')).toBeInTheDocument();
  });

  it('renders nothing at all for a single-item pass — the badge only earns its place above 1', () => {
    const { container } = render(<ItemOrdinal index={1} total={1} />);
    expect(container.firstChild).toBeNull();
  });
});

vi.mock('../../src/supabaseClient', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  for (const m of ['select', 'eq', 'order']) builder[m] = () => builder;
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: ITEMS, error: null }).then(ok);
  return { gp: () => ({ from: () => builder }) };
});

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill', description: 'Bosch',
    purpose: 'work', expected_return_date: null, quantity: 1, unit: 'nos',
    serial_no: null, approx_value: 5000, returned_qty: 0, returned_at: null,
    department_id: 'd1', is_open: true, created_at: new Date().toISOString(),
    outstanding_qty: 1, pass_number: 'RGP-1', pass_status: 'matched', return_status: 'awaiting_return',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ITEMS: GatePassItemView[] = [
  item({ id: 'l1', line_no: 1, name: 'Drill' }),
  item({ id: 'l2', line_no: 2, name: 'Ladder' }),
  item({ id: 'l3', line_no: 3, name: 'Cable' }),
];

const ONE_ITEM: GatePassItemView[] = [item({ id: 'l1', line_no: 1, name: 'Drill' })];

import VerifyItemsTable from '../../src/pages/Security/VerifyItemsTable';

describe('VerifyItemsTable — numbered lines', () => {
  it('shows visible ordinals 1, 2 and 3 for a three-item pass', () => {
    render(<VerifyItemsTable items={ITEMS} showReturnDates totalQuantity={3} />);
    expect(screen.getByLabelText('Item 1')).toBeInTheDocument();
    expect(screen.getByLabelText('Item 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Item 3')).toBeInTheDocument();
  });

  it('suppresses the ordinal badge for a single-item pass', () => {
    render(<VerifyItemsTable items={ONE_ITEM} showReturnDates totalQuantity={1} />);
    expect(screen.queryByLabelText(/^Item \d/)).not.toBeInTheDocument();
  });
});
