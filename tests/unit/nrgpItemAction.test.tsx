// The material table on a gate pass record — what each type shows, and who may
// touch it.
//
// Client, 2026-08-18: "what do you mean by 'in use'? Once it is out of the gate
// it should be marked as returned not in use ... under action put NA but status
// you mark it as closed for NRGP."
//
// Client, 2026-08-19: the record is where a return is ENTERED, per line and per
// quantity, and "once it is marked as returned, nothing can be edited anymore".
// So the Action column carries exactly one thing — "Mark return" — and it is
// drawn only for a guard, only on an RGP line that still owes material.
// Everything else reads NA.
//
// AN NRGP HAS NO RETURN COLUMNS AT ALL: it is not coming back, and Qty Returned
// / Pending Qty would be a column of zeroes describing an obligation that never
// existed.
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PassRecordItems from '../../src/components/passview/PassRecordItems';
import { itemReturnStage, ITEM_RETURN_STYLES } from '../../src/lib/passRecordView';
import { EMPTY_DRAFT } from '../../src/lib/returnDraft';
import type { GatePassItemView, GatePassView } from '../../src/types';

function line(over: Partial<GatePassItemView> = {}): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill Machine',
    description: 'Bosch 500W', serial_no: null, quantity: 2, unit: 'nos',
    returned_qty: 0, returned_at: null, approx_value: 5000,
    expected_return_date: null, outstanding_qty: 2,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'NRGP-20260818-0001', type: 'NRGP', direction: 'out',
    status: 'matched', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering',
    raised_by: 'u1', visitor_name: 'Ravi Kumar', visitor_company: null,
    vehicle_number: null, purpose: 'Scrap disposal',
    expected_return_date: null, actual_return_date: null,
    verified_by: 'g1', verified_at: '2026-08-18T07:00:00Z',
    flag_reason: null, flagged_at: null, hod_reviewed_at: null,
    qr_token: 'tok', expires_at: null,
    created_at: '2026-08-18T04:00:00Z', updated_at: '2026-08-18T07:00:00Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function renderItems(p: GatePassView, items: GatePassItemView[], canRecord = false) {
  return render(
    <MemoryRouter>
      <PassRecordItems
        pass={p}
        items={items}
        draft={EMPTY_DRAFT}
        canRecord={canRecord}
        onAdd={vi.fn()}
      />
    </MemoryRouter>,
  );
}

const RGP = pass({
  type: 'RGP', pass_number: 'RGP-20260818-0001', return_status: 'awaiting_return',
  expected_return_date: '2026-08-25', due_state: 'ok',
});

describe('an NRGP line is closed, not "not applicable"', () => {
  it('grades every NRGP line as closed', () => {
    expect(itemReturnStage(line(), 'NRGP')).toBe('closed');
    // The STAGE key stays 'closed' — it is internal, and unrelated to the word
    // printed. The WORD moved from "Closed" to "Out — No Return Due" (client,
    // 2026-09-01: "once a NRGP gate pass is cleared out the status of it
    // should show as out, not returned yet"), the same word the pass's own
    // badge now uses, so a line never disagrees with the card above it.
    expect(ITEM_RETURN_STYLES.closed.label).toBe('Out — No Return Due');
  });

  it('says Out — No Return Due in the status cell and offers no action at all', () => {
    renderItems(pass(), [line()]);
    expect(screen.getByText('Out — No Return Due')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('draws no return columns on an NRGP — nothing is owed back', () => {
    renderItems(pass(), [line()]);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).not.toContain('Qty Returned');
    expect(heads).not.toContain('Pending Qty');
    expect(heads).toContain('Quantity');
  });
});

describe('an RGP line carries its own return entry', () => {
  it('draws the mock-up\'s quantity columns, with the unit on every line', () => {
    renderItems(RGP, [line()]);
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    // The client's latest mock-up (2026-08-19): ONE Quantity column naming the
    // line's own unit, a real Serial / ID column, and no Unit column at all.
    // Make / Model joined them on 2026-08-23 — "put the make, model and brand
    // name against each item across all the views".
    expect(heads).toEqual([
      '#', 'Item', 'Description', 'Make / Model', 'Serial / ID', 'Quantity', 'Value',
      'Return Status', 'Action',
    ]);
  });

  it('offers Mark return to a GUARD on a line that still owes material', () => {
    renderItems(RGP, [line({ returned_qty: 0 }), line({ id: 'i2', returned_qty: 1 })], true);
    expect(screen.getAllByRole('button', { name: 'Mark return' })).toHaveLength(2);
    expect(screen.queryByText('NA')).not.toBeInTheDocument();
  });

  it('offers nobody else anything — apply_item_returns refuses them', () => {
    renderItems(RGP, [line({ returned_qty: 0 })], false);
    expect(screen.queryByRole('button', { name: /Mark return/ })).not.toBeInTheDocument();
    expect(screen.getByText('NA')).toBeInTheDocument();
  });

  it('has nothing left to do on a fully returned line, even for a guard', () => {
    renderItems(RGP, [line({ returned_qty: 2, outstanding_qty: 0 })], true);
    expect(screen.getByText('Returned')).toBeInTheDocument();
    expect(screen.getByText('NA')).toBeInTheDocument();
  });

  it('draws no Total row — the mock-up carries a progress line instead', () => {
    renderItems(RGP, [
      line({ id: 'a', quantity: 10, returned_qty: 4, approx_value: 1000 }),
      line({ id: 'b', quantity: 5, returned_qty: 0, approx_value: 500 }),
    ]);
    const last = within(screen.getByRole('table')).getAllByRole('row').at(-1)!;
    expect(within(last).queryByText('Total')).not.toBeInTheDocument();
    expect(screen.getByText('0 of 2 items returned')).toBeInTheDocument();
  });
});
