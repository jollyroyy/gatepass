// A stacked card lists its own material lines — numbered, and priced in ₹.
//
// Client, 2026-08-19: "mention serial number beside each item, both for RGP
// and NRGP, so mention the value of the items individually in INR in the
// stacked cards." Until now a card said "Items: 2 items" and stopped: the
// per-line value lived only on the full record, so an HOD reading their own
// register could not see which line was the expensive one without leaving the
// list.
//
// THE ORDINAL IS THE SERIAL NUMBER. `gate_pass_items.serial_no` is write-dead
// in this app, so a column of em dashes would say less than the line's own
// position does — and the position is the same "#" the guard's two panels
// already print.
//
// The lines are fetched ON DEMAND by `usePassItems`, so a collapsed card makes
// no query at all; these cases drive the drill card, which opens by default.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../src/types';
import type { DrillDef } from '../../src/lib/boardDrills';

let ITEMS: GatePassItemView[] = [];
let QUERIES = 0;

function builder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj: any = {};
  for (const m of ['select', 'order', 'eq', 'in', 'limit']) obj[m] = () => obj;
  obj.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) => {
    QUERIES += 1;
    return Promise.resolve({ data: ITEMS, error: null }).then(onOk, onErr);
  };
  return obj;
}

vi.mock('../../src/supabaseClient', () => ({
  gp: () => ({ from: () => builder() }),
  pub: () => ({ from: () => builder() }),
  supabase: { auth: { getUser: () => Promise.resolve({ data: { user: null } }) } },
}));

import DrillList from '../../src/components/DrillList';

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi Kumar', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Service', expected_return_date: '2026-08-25', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null,
    flag_reason: null, qr_token: 't', expires_at: null,
    created_at: '2026-08-19T04:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'ok',
    item_count: 2, total_quantity: 3, returned_quantity: 0,
    material_summary: 'Drill Machine',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill Machine', description: '',
    quantity: 1, unit: 'nos', returned_qty: 0, outstanding_qty: 1,
    approx_value: null, serial_no: null, expected_return_date: null, returned_at: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const DEF = {
  key: 'k', label: 'Some figure', heading: 'Some passes', empty: 'Nothing here',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as unknown as DrillDef<string>;

function renderCard(rows: GatePassView[] = [pass()]) {
  return render(
    <MemoryRouter>
      <DrillList def={DEF} loading={false} rows={rows} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  QUERIES = 0;
  ITEMS = [
    item({ id: 'i1', line_no: 1, name: 'Drill Machine', approx_value: 12500 }),
    item({ id: 'i2', line_no: 2, name: 'Extension Cable', quantity: 2, approx_value: 850 }),
  ];
});

describe('an opened stacked card lists its lines', () => {
  it('numbers each line and prices it in rupees', async () => {
    renderCard();
    const table = within(await screen.findByTestId('pass-item-lines'));
    const rows = table.getAllByRole('row').slice(1);

    // Cell 0 is the serial number, cell 3 the value — asserted by position,
    // because a quantity of 1 also renders the text "1".
    const cells = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent);
    expect(cells(rows[0])).toEqual(['1', 'Drill Machine', '1', '₹12,500']);
    expect(cells(rows[1])).toEqual(['2', 'Extension Cable', '2', '₹850']);
  });

  it('does it for an NRGP too — value is not a returnable-only fact', async () => {
    renderCard([pass({ type: 'NRGP', return_status: 'not_applicable', expected_return_date: null })]);
    const table = within(await screen.findByTestId('pass-item-lines'));
    expect(table.getByText('₹12,500')).toBeInTheDocument();
  });

  it('leaves an unpriced line blank rather than claiming it is worth nothing', async () => {
    ITEMS = [item({ id: 'i1', approx_value: null })];
    renderCard();
    const table = within(await screen.findByTestId('pass-item-lines'));
    expect(table.getByText('—')).toBeInTheDocument();
    expect(table.queryByText('₹0')).not.toBeInTheDocument();
  });

  // Client, 2026-08-19: "put value in all the details and the cards … and the
  // overall total value." A card that prices every line and never adds them up
  // makes the reader do the arithmetic that decides whether a load matters.
  it('foots the value column with the pass total', async () => {
    renderCard();
    const table = within(await screen.findByTestId('pass-item-lines'));
    expect(table.getByText('Total Value')).toBeInTheDocument();
    expect(table.getByTestId('item-lines-total')).toHaveTextContent('₹13,350');
  });

  it('adds up only the priced lines, and draws no total when none are priced', async () => {
    ITEMS = [item({ id: 'i1', approx_value: null }), item({ id: 'i2', approx_value: 850 })];
    renderCard();
    const table = within(await screen.findByTestId('pass-item-lines'));
    expect(table.getByTestId('item-lines-total')).toHaveTextContent('₹850');

    ITEMS = [item({ id: 'i1', approx_value: null })];
    renderCard();
    await waitFor(() => expect(screen.getAllByTestId('pass-item-lines').length).toBeGreaterThan(1));
    expect(screen.queryAllByText('Total Value')).toHaveLength(1);
  });

  it('asks the database once per opened card, not once per list', async () => {
    renderCard([pass(), pass({ id: 'p2', pass_number: 'RGP-20260819-0002' })]);
    await waitFor(() => expect(screen.getAllByTestId('pass-item-lines')).toHaveLength(2));
    expect(QUERIES).toBe(2);
  });
});
