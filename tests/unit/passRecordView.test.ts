import { describe, it, expect } from 'vitest';
import {
  itemReturnStage,
  ITEM_RETURN_STYLES,
  returnProgress,
  pendingItemCount,
  passRecordStages,
  relativeSince,
} from '../../src/lib/passRecordView';
import type { GatePassItemView, GatePassView } from '../../src/types';

function line(over: Partial<GatePassItemView> = {}): GatePassItemView {
  return {
    id: 'i1',
    gate_pass_id: 'p1',
    line_no: 1,
    name: 'Dell Precision Laptop 5570',
    description: 'IT Equipment',
    purpose: 'site work',
    expected_return_date: null,
    quantity: 1,
    unit: 'nos',
    serial_no: 'IT-LTP-0842',
    approx_value: 90000,
    returned_qty: 0,
    returned_at: null,
    department_id: 'd1',
    is_open: true,
    created_at: '2026-08-18T04:12:00.000Z',
    outstanding_qty: 1,
    pass_number: 'RGP-OUT-20260818-0001',
    pass_status: 'matched',
    return_status: 'awaiting_return',
    ...over,
  } as GatePassItemView;
}

function pass(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p1',
    pass_number: 'RGP-OUT-20260818-0001',
    type: 'RGP',
    direction: 'out',
    status: 'matched',
    department_id: 'd1',
    raised_by: 'u1',
    visitor_name: 'Rohan Sharma',
    visitor_company: JSON.stringify({ n: 'BSC', a: 'Kolkata', v: '9876543210' }),
    vehicle_number: 'WB01AB1234',
    purpose: 'Plant 2 — Fabrication Bay',
    expected_return_date: '2026-08-18',
    return_status: 'awaiting_return',
    actual_return_date: null,
    verified_by: 'g1',
    verified_at: '2026-08-18T04:20:00.000Z',
    flag_reason: null,
    qr_token: 'tok',
    expires_at: '2026-08-19T18:29:59.000Z',
    created_at: '2026-08-18T04:12:00.000Z',
    updated_at: '2026-08-18T10:50:00.000Z',
    is_overdue: false,
    is_expired: false,
    due_state: 'due_today',
    flagged_at: null,
    hod_reviewed_at: null,
    item_count: 5,
    total_quantity: 6,
    returned_quantity: 3,
    material_summary: 'Laptop, Drill',
    total_value: 100000,
    department_name: 'Engineering',
    department_code: 'ENG',
    raised_by_name: 'Neha Kapoor',
    verified_by_name: 'Guard',
    ...over,
  } as GatePassView;
}

describe('itemReturnStage', () => {
  it('grades a line by quantities, not by returned_at', () => {
    expect(itemReturnStage(line({ quantity: 2, returned_qty: 0 }), 'RGP')).toBe('pending');
    expect(itemReturnStage(line({ quantity: 2, returned_qty: 1, returned_at: null }), 'RGP')).toBe('partial');
    expect(itemReturnStage(line({ quantity: 2, returned_qty: 2 }), 'RGP')).toBe('returned');
  });

  it('has no return leg at all for an NRGP line', () => {
    expect(itemReturnStage(line({ quantity: 2, returned_qty: 0 }), 'NRGP')).toBe('not_applicable');
  });

  it('names every stage', () => {
    expect(ITEM_RETURN_STYLES.pending.label).toBe('Pending');
    expect(ITEM_RETURN_STYLES.partial.label).toBe('Partially Returned');
    expect(ITEM_RETURN_STYLES.returned.label).toBe('Returned');
  });
});

describe('returnProgress', () => {
  it('counts lines fully back, out of all lines', () => {
    const items = [
      line({ id: 'a', quantity: 1, returned_qty: 1 }),
      line({ id: 'b', quantity: 1, returned_qty: 1 }),
      line({ id: 'c', quantity: 2, returned_qty: 2 }),
      line({ id: 'd', quantity: 1, returned_qty: 0 }),
      line({ id: 'e', quantity: 2, returned_qty: 1 }),
    ];
    expect(returnProgress(items, 'RGP')).toEqual({ returned: 3, total: 5, percent: 60 });
  });

  it('is 0 of 0 at 0% for an empty pass — never NaN', () => {
    expect(returnProgress([], 'RGP')).toEqual({ returned: 0, total: 0, percent: 0 });
  });
});

describe('pendingItemCount', () => {
  it('counts pending AND partial — a half-returned line is not settled', () => {
    const items = [
      line({ id: 'a', quantity: 1, returned_qty: 1 }),
      line({ id: 'd', quantity: 1, returned_qty: 0 }),
      line({ id: 'e', quantity: 2, returned_qty: 1 }),
    ];
    expect(pendingItemCount(items, 'RGP')).toBe(2);
    expect(pendingItemCount(items, 'NRGP')).toBe(0);
  });
});

describe('passRecordStages', () => {
  it('runs Issued → In Use → the current return stage', () => {
    const stages = passRecordStages(pass({ return_status: 'partially_returned' }));
    expect(stages.map((s) => s.label)).toEqual(['Issued', 'In Use', 'Partially Returned']);
    expect(stages[0].at).toBe('2026-08-18T04:12:00.000Z');
    expect(stages[2].at).toBe('2026-08-18T10:50:00.000Z');
  });

  it('names a closed pass Returned, at its actual return date', () => {
    const stages = passRecordStages(
      pass({ return_status: 'returned', actual_return_date: '2026-08-18T12:00:00.000Z' }),
    );
    expect(stages.map((s) => s.label)).toEqual(['Issued', 'In Use', 'Returned']);
  });

  it('is a single moment for a pass still waiting at the gate', () => {
    const stages = passRecordStages(
      pass({ status: 'pending', verified_at: null, return_status: 'not_applicable' }),
    );
    expect(stages.map((s) => s.label)).toEqual(['Issued']);
  });
});

describe('relativeSince', () => {
  const now = new Date('2026-08-18T12:00:00.000Z');
  it('reads in the largest whole unit', () => {
    expect(relativeSince('2026-08-18T11:58:00.000Z', now)).toBe('2 min ago');
    expect(relativeSince('2026-08-18T09:00:00.000Z', now)).toBe('3 hr ago');
    expect(relativeSince('2026-08-17T09:00:00.000Z', now)).toBe('1 day ago');
    expect(relativeSince('2026-08-15T09:00:00.000Z', now)).toBe('3 days ago');
  });
  it('never shows a broken clock', () => {
    expect(relativeSince('2026-08-18T12:00:00.000Z', now)).toBe('just now');
    expect(relativeSince(null, now)).toBe('—');
  });
});
