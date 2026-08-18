// An NRGP line is CLOSED, and its Action cell is empty of links.
//
// Client, 2026-08-18: "what do you mean by 'in use'? Once it is out of the
// gate it should be marked as returned not in use ... remove the view and
// under action put NA but status you mark it as closed for NRGP. Similarly
// for RGP ... under the action for the individual item level put the return
// marking."
//
// So the Action column carries exactly one thing — the return action — and
// nothing else. A line with no return left to record reads NA, on either
// type: "View" was a second route to the page the reader is already on, and
// an NRGP never owes anything at all.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PassRecordItems from '../../src/components/passview/PassRecordItems';
import { itemReturnStage, ITEM_RETURN_STYLES, passRecordStages } from '../../src/lib/passRecordView';
import type { GatePassItemView, GatePassView } from '../../src/types';

function line(over: Partial<GatePassItemView> = {}): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill Machine',
    description: 'Bosch 500W', serial_no: null, quantity: 2, unit: 'nos',
    returned_qty: 0, returned_at: null, approx_value: 5000,
    expected_return_date: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1', pass_number: 'NRGP-OUT-20260818-0001', type: 'NRGP', direction: 'out',
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

function renderItems(p: GatePassView, items: GatePassItemView[]) {
  return render(
    <MemoryRouter>
      <PassRecordItems pass={p} items={items} />
    </MemoryRouter>,
  );
}

describe('an NRGP line is closed, not "not applicable"', () => {
  it('grades every NRGP line as closed', () => {
    expect(itemReturnStage(line(), 'NRGP')).toBe('closed');
    expect(ITEM_RETURN_STYLES.closed.label).toBe('Closed');
  });

  it('says Closed in the status cell and NA in the action cell', () => {
    renderItems(pass(), [line()]);
    expect(screen.getByText('Closed')).toBeInTheDocument();
    expect(screen.getByText('NA')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('closes an NRGP at the gate instead of putting it "In Use"', () => {
    expect(passRecordStages(pass()).map((s) => s.label)).toEqual(['Issued', 'Closed']);
  });

  it('still calls a cleared RGP In Use — it is out and owed back', () => {
    const rgp = pass({
      type: 'RGP', pass_number: 'RGP-OUT-20260818-0001', return_status: 'awaiting_return',
      expected_return_date: '2026-08-25', due_state: 'ok',
    });
    expect(passRecordStages(rgp).map((s) => s.label)).toEqual(['Issued', 'In Use']);
  });
});

describe('an RGP line carries its own return marking', () => {
  const rgp = pass({
    type: 'RGP', pass_number: 'RGP-OUT-20260818-0001', return_status: 'awaiting_return',
    expected_return_date: '2026-08-25', due_state: 'ok',
  });

  it('offers Mark return on a line that still owes material', () => {
    renderItems(rgp, [line({ returned_qty: 0 }), line({ id: 'i2', returned_qty: 1 })]);
    expect(screen.getAllByRole('link', { name: /Mark return/ })).toHaveLength(2);
    expect(screen.queryByText('NA')).not.toBeInTheDocument();
  });

  it('has nothing left to do on a fully returned line', () => {
    renderItems(rgp, [line({ returned_qty: 2 })]);
    expect(screen.getByText('Returned')).toBeInTheDocument();
    expect(screen.getByText('NA')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
