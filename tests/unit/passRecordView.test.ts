import { describe, it, expect } from 'vitest';
import {
  itemReturnStage,
  ITEM_RETURN_STYLES,
  returnProgress,
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

  it('closes an NRGP line — it has no return leg at all', () => {
    // Client, 2026-08-18: "once it is out of the gate it should be marked ...
    // closed for NRGP." Not 'pending' (it would never clear) and no longer
    // 'N/A' (the line HAS an outcome).
    expect(itemReturnStage(line({ quantity: 2, returned_qty: 0 }), 'NRGP')).toBe('closed');
  });

  it('names every stage', () => {
    expect(ITEM_RETURN_STYLES.closed.label).toBe('Closed');
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

// `pendingItemCount` and `passRecordStages` were DELETED on 2026-08-19 with
// their last callers: the record's stage strip became the approval ladder
// (`approvalLadder.ts`, pinned by approvalLadder.test.ts) and the "N items still
// need attention" banner went with the mock-up's own layout. Their cases are
// gone rather than pointed at something else — a test with no subject proves
// nothing.
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
