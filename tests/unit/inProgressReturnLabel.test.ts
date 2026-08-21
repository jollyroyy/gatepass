// A PASS STILL OUT READS "In Progress", AND A PARTLY RETURNED ONE READS
// "Partially Returned" — and the percentage over the item table is computed on
// QUANTITIES, not on lines fully back.
//
// Client, 2026-08-21: "for the status of those passes which have not been
// returned yet, just make them from 'not in progress' to 'in progress'. Within
// 'in progress' you can mention it as 'partially returned'." … "even if they
// partially return, like three headsets out of eight, on the top it is still
// showing 0% — calculate the percentage accordingly. Even if it is a small
// percentage, don't show it as 0%."
//
// The old label was "Out — Not Returned", which named the ABSENCE of an event
// rather than the state the pass is in, and "Partly Returned", which is a
// second spelling of a phrase the rest of the app already writes out in full
// (`ITEM_RETURN_STYLES.partial`, `PASS_RETURN_LABELS`, the return legend).
//
// The percentage was 0% for a genuinely part-returned pass because
// `returnProgress` counted LINES FULLY BACK: three of eight headsets on one
// line closes no line at all, so the bar read 0% over a table plainly showing
// material back. The sentence beside it still counts lines — it says "items" —
// but the FIGURE and the bar are the share of the material.
import { describe, it, expect } from 'vitest';
import type { GatePassItemView } from '../../src/types';
import { RGP_STAGE_STYLES } from '../../src/lib/rgpLifecycle';
import { RETURN_STYLES } from '../../src/lib/statusStyles';
import { STAGE_TONES } from '../../src/lib/passStackCard';
import { returnProgress } from '../../src/lib/passRecordView';
import {
  applyReportFilters, STATUS_FILTERS, type StatusFilter,
} from '../../src/lib/gatePassReport';
import type { GatePassView } from '../../src/types';

function view(over: Partial<GatePassView> = {}): GatePassView {
  return {
    id: 'p', type: 'RGP', status: 'pending', return_status: 'not_applicable',
    is_expired: false, is_overdue: false, created_at: '2026-08-20T04:00:00Z',
    raised_by: 'u1', department_id: 'd1',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...over } as any;
}

const ALL = {
  from: '2026-01-01', to: '2026-12-31', type: 'all', createdBy: '', department: '',
} as const;

function ids(rows: GatePassView[], status: StatusFilter): string[] {
  return applyReportFilters(rows, { ...ALL, status }).map((p) => p.id);
}

function line(quantity: number, returned_qty: number): GatePassItemView {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { id: `i${quantity}-${returned_qty}`, quantity, returned_qty, unit: 'nos' } as any;
}

describe('the return leg is named "In Progress" / "Partially Returned"', () => {
  it('names a pass still out "In Progress"', () => {
    expect(RGP_STAGE_STYLES.out_open.label).toBe('In Progress');
  });

  it('names a part-returned pass "Partially Returned", on both maps', () => {
    expect(RGP_STAGE_STYLES.partly_returned.label).toBe('Partially Returned');
    expect(RETURN_STYLES.partially_returned.label).toBe('Partially Returned');
  });

  it('no map still carries the old wording', () => {
    const labels = [
      ...Object.values(RGP_STAGE_STYLES).map((s) => s.label),
      ...Object.values(RETURN_STYLES).map((s) => s.label),
    ];
    expect(labels).not.toContain('Out — Not Returned');
    expect(labels).not.toContain('Partly Returned');
  });

  it('tones both new labels, so no stacked card falls back to grey', () => {
    expect(STAGE_TONES['In Progress']).toBe('blue');
    expect(STAGE_TONES['Partially Returned']).toBe('blue');
    expect(STAGE_TONES['Out — Not Returned']).toBeUndefined();
    expect(STAGE_TONES['Partly Returned']).toBeUndefined();
  });
});

describe('returnProgress counts quantity, not closed lines', () => {
  it('reads 38% for three of eight headsets on one line', () => {
    const p = returnProgress([line(8, 3)], 'RGP');
    expect(p.percent).toBe(38);
  });

  it('still counts LINES for the sentence beside the figure', () => {
    const p = returnProgress([line(8, 3), line(2, 2)], 'RGP');
    expect(p.returned).toBe(1);
    expect(p.total).toBe(2);
    expect(p.percent).toBe(50); // 5 of 10 units
  });

  it('never reads 0% while any material is back', () => {
    expect(returnProgress([line(1000, 1)], 'RGP').percent).toBe(1);
  });

  it('never reads 100% while any material is still out', () => {
    expect(returnProgress([line(1000, 999)], 'RGP').percent).toBe(99);
  });

  it('is 0% with nothing back and 100% when everything is', () => {
    expect(returnProgress([line(8, 0)], 'RGP').percent).toBe(0);
    expect(returnProgress([line(8, 8), line(2, 2)], 'RGP').percent).toBe(100);
  });

  it('is 0 of 0 at 0% on an empty pass, never NaN', () => {
    expect(returnProgress([], 'RGP')).toEqual({ returned: 0, total: 0, percent: 0 });
  });

  it('is 100% on an NRGP, whose lines are closed the moment they leave', () => {
    expect(returnProgress([line(4, 0)], 'NRGP').percent).toBe(100);
  });
});

// ─── The two desks a waiting pass can be sitting on ──────────────────────────
//
// Client, 2026-08-21: "in the report also show pending gate review and pending
// for approval as a drop-down filter for admin, for the entire department and
// for individual HOD also. Under report they should see the right number of
// items that are pending for gate review as well as pending any kind of
// approvals."
//
// Both are SUBSETS of the In Progress bucket, so the three buckets still sum to
// the total; and both are `pendingSplit`'s own predicates, so the report and the
// two dashboards cannot disagree about the figure. The HOD gets them for free —
// `/reports` renders the same `ReportsFilterBar`, and RLS is what scopes the
// rows to their department.
describe('the report filters by which desk a pass is waiting on', () => {
  const rows = [
    view({ id: 'a', status: 'pending', awaits_approval: true }),
    view({ id: 'b', status: 'pending', awaits_approval: false }),
    view({ id: 'c', status: 'pending' }),                       // no ladder at all
    view({ id: 'd', status: 'pending', awaits_approval: true, is_expired: true }),
    view({ id: 'e', status: 'matched', return_status: 'returned' }),
  ];

  it('offers both, under In Progress', () => {
    const keys = STATUS_FILTERS.map((s) => s.key);
    expect(keys).toContain('pending_gate');
    expect(keys).toContain('pending_approval');
    expect(STATUS_FILTERS.find((s) => s.key === 'pending_gate')?.label)
      .toBe('Pending Gate Review');
    expect(STATUS_FILTERS.find((s) => s.key === 'pending_approval')?.label)
      .toBe('Pending Approval');
  });

  it('counts a pass with no ladder at the GATE, never as pending approval', () => {
    expect(ids(rows, 'pending_gate')).toEqual(['b', 'c']);
    expect(ids(rows, 'pending_approval')).toEqual(['a']);
  });

  it('counts an expired pass on neither desk — nothing can clear it', () => {
    expect(ids(rows, 'pending_gate')).not.toContain('d');
    expect(ids(rows, 'pending_approval')).not.toContain('d');
    expect(ids(rows, 'expired')).toEqual(['d']);
  });

  it('sums to the In Progress bucket\'s own waiting passes', () => {
    const both = [...ids(rows, 'pending_gate'), ...ids(rows, 'pending_approval')].sort();
    expect(both).toEqual(['a', 'b', 'c']);
    // Every one of them is In Progress — the two options narrow a bucket, they
    // do not add a fourth.
    for (const id of both) {
      expect(ids(rows, 'in_progress')).toContain(id);
    }
  });
});
