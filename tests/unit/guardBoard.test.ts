// The guard's board is TWO QUESTIONS, and this module answers both.
//
// Client mock-up, 2026-08-19: the board was seven drill KPIs and a stack of
// pass cards; it is now "Pending OUT (Needs Approval)" and "Pending RGP Return
// (Needs Verification)", each a figure with the very list under it. So the
// invariant that mattered on the old board still holds and is what these cases
// pin: a number on a card is `rows.length` of the array the panel beside it
// renders, never a second predicate.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  PREVIEW_ROWS, firstNameOf, needsReturnVerification, partyOf, pendingOutOf,
  pendingReturnsOf, previewOf, returnedQtyLabel, typeSplit,
} from '../../src/lib/guardBoard';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: '2026-08-19T04:50:00.000Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('Pending OUT — what is waiting at the barrier', () => {
  it('takes pending AND hod_reviewed, and nothing the gate has finished with', () => {
    const rows = pendingOutOf([
      pass({ id: 'a', status: 'pending' }),
      pass({ id: 'b', status: 'hod_reviewed' }),
      pass({ id: 'c', status: 'matched' }),
      pass({ id: 'd', status: 'flagged' }),
      pass({ id: 'e', status: 'held' }),
    ]);
    expect(rows.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('puts the longest wait first — a truck that arrived at 10:20 is served before 10:30', () => {
    const rows = pendingOutOf([
      pass({ id: 'late', created_at: '2026-08-19T05:00:00.000Z' }),
      pass({ id: 'early', created_at: '2026-08-19T04:50:00.000Z' }),
    ]);
    expect(rows.map((p) => p.id)).toEqual(['early', 'late']);
  });

  it('splits the one list by type, so the two figures always sum to it', () => {
    const rows = pendingOutOf([
      pass({ id: 'a', type: 'RGP' }),
      pass({ id: 'b', type: 'NRGP', direction: 'out' }),
      pass({ id: 'c', type: 'NRGP', direction: 'out' }),
    ]);
    const split = typeSplit(rows);
    expect(split).toEqual({ RGP: 1, NRGP: 2 });
    expect(split.RGP + split.NRGP).toBe(rows.length);
  });
});

describe('Pending RGP Return — what the gate can actually verify today', () => {
  const due = pass({
    id: 'due', status: 'matched', return_status: 'awaiting_return',
    expected_return_date: '2026-08-19', due_state: 'due_today',
  });
  const late = pass({
    id: 'late', status: 'matched', return_status: 'partially_returned',
    expected_return_date: '2026-05-18', due_state: 'overdue', is_overdue: true,
  });
  const later = pass({
    id: 'later', status: 'matched', return_status: 'awaiting_return',
    expected_return_date: '2026-10-01', due_state: 'ok',
  });

  it('is due-today material only — an overdue pass belongs to Overdue', () => {
    // A pass whose date has passed is chased on /overdue and NOWHERE else
    // (client, 2026-08-23). It stood in both queues at once and the two
    // figures read as two different obligations for one slip.
    expect(needsReturnVerification(due)).toBe(true);
    expect(needsReturnVerification(late)).toBe(false);
    // Material due in October is a real obligation no guard is watching the
    // barrier for, and /returns would not accept its return today either.
    expect(needsReturnVerification(later)).toBe(false);
  });

  it('ignores a pass whose return is already closed', () => {
    expect(needsReturnVerification(pass({ return_status: 'returned', due_state: 'due_today' }))).toBe(false);
    expect(needsReturnVerification(pass({ return_status: 'not_applicable', due_state: 'due_today' }))).toBe(false);
  });

  it('lists the oldest expected date first', () => {
    const alsoDue = pass({
      id: 'also', status: 'matched', return_status: 'awaiting_return',
      expected_return_date: '2026-08-18', due_state: 'due_today',
    });
    expect(pendingReturnsOf([due, later, late, alsoDue]).map((p) => p.id)).toEqual(['also', 'due']);
  });

  it('reads the returned quantity off the view, never re-summing lines', () => {
    expect(returnedQtyLabel(pass({ returned_quantity: 150, total_quantity: 200 }))).toBe('150 / 200');
  });
});

describe('The party, the preview and the greeting', () => {
  it('names the tenant or contractor, falling back to the person carrying it', () => {
    expect(partyOf(pass({ visitor_company: '{"n":"LMN Contractors","a":"","v":"9876543210"}' }))).toBe('LMN Contractors');
    expect(partyOf(pass({ visitor_company: '{"n":"","a":"","v":""}', visitor_name: 'Ravi' }))).toBe('Ravi');
    expect(partyOf(pass({ visitor_company: null, visitor_name: 'Ravi' }))).toBe('Ravi');
  });

  it('shows five rows until the reader asks for the rest', () => {
    const rows = Array.from({ length: 8 }, (_, i) => i);
    expect(previewOf(rows, false)).toHaveLength(PREVIEW_ROWS);
    expect(previewOf(rows, true)).toHaveLength(8);
  });

  it('greets by first name, and greets a nameless session as Guard', () => {
    expect(firstNameOf('Ravi Kumar Sharma')).toBe('Ravi');
    expect(firstNameOf('   ')).toBe('Guard');
    expect(firstNameOf(null)).toBe('Guard');
  });
});
