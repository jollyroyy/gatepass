// THE MONEY IS ON THE GUARD'S SCREENS (client, 2026-08-21: "in the card view in
// the dashboard, when he's just expanding the stacked card there, you put a
// column for value and put all the individual values. On top in the
// description, where you are showing all the description and vendor details,
// there you mention their total value for all the items. Even for the overdue
// items or so, whatever is showing in the stacked card, they should have a
// value column." — narrowed a moment later to "guard view").
//
// What these cases hold:
//   1. EVERY UNFOLDED ITEM PANEL A GUARD OPENS NAMES EACH LINE'S VALUE — the
//      Pending OUT row and the Pending RGP Return row. An unpriced line is a
//      DASH, never ₹0: `approx_value` is optional and "nothing declared" is not
//      "declared zero", the same rule the record's item table follows.
//   2. THE BLOCK BESIDE IT CARRIES THE PASS'S TOTAL, read off
//      `v_gate_passes.total_value` and NEVER re-summed from the lines — the
//      rule the overdue KPI and the stacked card already live by.
//   3. THE OVERDUE STACKED CARD CARRIES TOTAL VALUE among its facts, which is
//      the one guard surface that is a card rather than a row.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';

let ITEMS: GatePassItemView[] = [];
vi.mock('../../src/lib/usePassItems', () => ({
  usePassItems: (id: string | null) => ({ items: id ? ITEMS : undefined, error: null }),
}));

import PendingOutRow from '../../src/components/guard/PendingOutRow';
import PendingReturnItems from '../../src/components/guard/PendingReturnItems';
import ReturnRowMeta from '../../src/components/guard/ReturnRowMeta';
import OverduePassCard from '../../src/components/overdue/OverduePassCard';
import { buildOverduePasses } from '../../src/lib/overduePasses';
import { EMPTY_DRAFT } from '../../src/lib/returnDraft';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'Ramesh Kumar',
    visitor_name: 'Ravi', visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}',
    vehicle_number: 'KA01AB1234', purpose: 'Repair',
    expected_return_date: '2026-08-18', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: '2026-08-30T18:30:00Z', created_at: '2026-08-18T04:50:00Z',
    is_overdue: true, is_expired: false, due_state: 'overdue',
    item_count: 2, total_quantity: 3, returned_quantity: 0, total_value: 41200,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView> = {}): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Fluke Multimeter',
    description: 'Model 87V', purpose: null, expected_return_date: null,
    quantity: 2, unit: 'nos', serial_no: null, approx_value: 40000,
    returned_qty: 0, outstanding_qty: 2, returned_at: null, make_model: null,
    invoice_no: null, remarks: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('Pending OUT — the panel a guard unfolds', () => {
  it('prices every material line, and dashes an unpriced one', () => {
    ITEMS = [item({}), item({ id: 'i2', line_no: 2, name: 'Base Plate', approx_value: null })];
    render(
      <MemoryRouter>
        <table><tbody>
          <PendingOutRow pass={pass()} open onToggle={() => undefined} />
        </tbody></table>
      </MemoryRouter>,
    );
    const table = screen.getByText('Fluke Multimeter').closest('table') as HTMLTableElement;
    expect(within(table).getByRole('columnheader', { name: 'Value' })).toBeTruthy();
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]).getByText('₹40,000')).toBeTruthy();
    expect(within(rows[2]).getByText('—')).toBeTruthy();
  });

  it('states the pass total beside the vendor and purpose facts', () => {
    ITEMS = [item({})];
    render(
      <MemoryRouter>
        <table><tbody>
          <PendingOutRow pass={pass()} open onToggle={() => undefined} />
        </tbody></table>
      </MemoryRouter>,
    );
    expect(screen.getByText('Total Value')).toBeTruthy();
    // The VIEW's own column, not a sum of the two lines on screen.
    expect(screen.getByText('₹41,200')).toBeTruthy();
  });
});

describe('Pending RGP Return — the panel a guard records a return in', () => {
  it('prices every material line, and dashes an unpriced one', () => {
    render(
      <PendingReturnItems
        items={[item({}), item({ id: 'i2', line_no: 2, name: 'Base Plate', approx_value: null })]}
        draft={EMPTY_DRAFT}
        onAdd={() => undefined}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(within(rows[1]).getByText('₹40,000')).toBeTruthy();
    expect(within(rows[2]).getByText('—')).toBeTruthy();
  });

  it('states the pass total in the block beside it', () => {
    render(<ReturnRowMeta pass={pass()} />);
    expect(screen.getByText('Total Value')).toBeTruthy();
    expect(screen.getByText('₹41,200')).toBeTruthy();
  });
});

describe('the overdue stacked card', () => {
  it('carries Total Value among its facts, and a dash when nothing was priced', () => {
    const rows = buildOverduePasses([pass()], [item({})]);
    const { unmount } = render(
      <MemoryRouter><ul><OverduePassCard row={rows[0]} canProcessReturn /></ul></MemoryRouter>,
    );
    expect(screen.getByText('Total Value')).toBeTruthy();
    expect(screen.getByText('₹41,200')).toBeTruthy();
    unmount();

    const bare = buildOverduePasses([pass({ total_value: 0 })], [item({ approx_value: null })]);
    render(<MemoryRouter><ul><OverduePassCard row={bare[0]} canProcessReturn /></ul></MemoryRouter>);
    expect(screen.getByText('Total Value')).toBeTruthy();
    expect(screen.queryByText('₹0')).toBeNull();
  });
});
