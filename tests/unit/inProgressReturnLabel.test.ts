// NOTHING IN ANY REPORT OR ANY VIEW SAYS "In Progress". That much has been true
// since 2026-08-21 and stays true. WHAT CHANGED ON 2026-09-01 IS THE NEXT
// CLAIM THIS FILE USED TO MAKE: that the whole return leg, both open halves of
// it, shares the one word "Partially Returned".
//
// Client, 2026-08-21 (twice, the second time as a plain instruction): "make the
// filter also in the status … replace the 'in progress' with 'partially
// returned' across all the reporting everywhere in all the views." That
// collapsed `RGP_STAGE_STYLES.out_open` and `.partly_returned` onto one label —
// and flagged its own cost in a comment: "a pass with NOTHING back now reads
// 'Partially Returned' too."
//
// Client, 2026-09-01, called that cost in: "once a NRGP gate pass is cleared
// out the status should show as out, not returned yet … and its status should
// be changed to returned or partially returned only when any of its items has
// been returned." So the two open stages SPLIT BACK APART: nothing back reads
// "Out — Awaiting Return", and "Partially Returned" is reserved for a pass that
// truly has a line home. The report's aggregate CARD still lumps both halves —
// one card cannot say two things — but its word is now "Out", and the ROW under
// it says which half, in `passStageStyle`'s own words (`reportStatusLabel`).
//
// The two intents worth keeping from the file's first life: nothing anywhere
// reads "In Progress", and one label always maps to exactly one style.
//
// The percentage half of this file is unchanged: `returnProgress` counts
// QUANTITIES, not lines fully back.
import { describe, it, expect } from 'vitest';
import type { GatePassItemView } from '../../src/types';
import { RGP_STAGE_STYLES } from '../../src/lib/rgpLifecycle';
import { RETURN_STYLES } from '../../src/lib/statusStyles';
import { STAGE_TONES } from '../../src/lib/passStackCard';
import { returnProgress } from '../../src/lib/passRecordView';
import {
  applyReportFilters, buildReportKpis, reportStatusLabel, REPORT_STATUS_LABELS,
  STATUS_FILTERS, type StatusFilter,
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

describe('the two open stages are named again, and nothing is "In Progress"', () => {
  it('names a pass still out, nothing back, "Out — Awaiting Return"', () => {
    expect(RGP_STAGE_STYLES.out_open.label).toBe('Out — Awaiting Return');
  });

  it('reserves "Partially Returned" for a pass that really has a line back', () => {
    expect(RGP_STAGE_STYLES.partly_returned.label).toBe('Partially Returned');
    expect(RETURN_STYLES.partially_returned.label).toBe('Partially Returned');
  });

  // ONE LABEL, ONE STYLE — the enduring rule, even though the two open stages
  // no longer SHARE a label (client, 2026-09-01 split them apart). They still
  // share every other property of the style object — same hue, same dot —
  // because they are one situation at two depths and a colour difference
  // between them would be nothing at all on the mono laser the register
  // prints on. Only the words, which the reader actually gets, differ.
  it('keeps the two open stages one hue, distinguished by word alone', () => {
    const { label: outLabel, ...outRest } = RGP_STAGE_STYLES.out_open;
    const { label: partlyLabel, ...partlyRest } = RGP_STAGE_STYLES.partly_returned;
    expect(outRest).toEqual(partlyRest);
    expect(outLabel).not.toBe(partlyLabel);
  });

  it('no map still carries the old wording', () => {
    const labels = [
      ...Object.values(RGP_STAGE_STYLES).map((s) => s.label),
      ...Object.values(RETURN_STYLES).map((s) => s.label),
      ...Object.values(REPORT_STATUS_LABELS),
      ...STATUS_FILTERS.map((s) => s.label),
    ];
    expect(labels).not.toContain('In Progress');
    expect(labels).not.toContain('Out — Not Returned');
    expect(labels).not.toContain('Partly Returned');
    // "Closed" retired from the badge on 2026-09-01 too — it survives only on
    // the timeline's own closing rung, which this file does not touch.
    expect(labels).not.toContain('Closed');
  });

  it('tones both open-stage labels, so no stacked card falls back to grey', () => {
    expect(STAGE_TONES['Out — Awaiting Return']).toBe('blue');
    expect(STAGE_TONES['Partially Returned']).toBe('blue');
    expect(STAGE_TONES['In Progress']).toBeUndefined();
  });
});

// ─── The register says the same word as the badge ────────────────────────────
describe('the report bucket and its filter option are "Out"; the row still says which half', () => {
  it('labels the bucket that way', () => {
    expect(REPORT_STATUS_LABELS.in_progress).toBe('Out');
  });

  // THE DROPDOWN AND THE CARD ARE ONE BUCKET, so they say one word. This is a
  // regression test with a real history: `STATUS_FILTERS` hardcoded the string
  // rather than reading `REPORT_STATUS_LABELS.in_progress`, so when the bucket
  // was renamed on 2026-09-01 the KPI card said "Out" and the very dropdown
  // that filtered to it still offered "Partially Returned". Asserting them
  // EQUAL, rather than both against a literal, is what makes the next rename
  // safe — one of the two drifting is the failure this catches.
  it('offers it in the Status select, under the same key and the same word', () => {
    const opt = STATUS_FILTERS.find((s) => s.key === 'in_progress');
    expect(opt?.label).toBe(REPORT_STATUS_LABELS.in_progress);
    const cards = buildReportKpis([]);
    expect(opt?.label).toBe(cards.find((c) => c.key === 'in_progress')?.label);
  });

  it('names the KPI card over that list the same', () => {
    const cards = buildReportKpis([]);
    expect(cards.find((c) => c.key === 'in_progress')?.label).toBe('Out');
  });

  it('still reads Overdue / Expired where something sharper is true', () => {
    expect(reportStatusLabel(view({ status: 'matched', return_status: 'awaiting_return', is_overdue: true })))
      .toBe('Overdue');
    expect(reportStatusLabel(view({ status: 'pending', is_expired: true }))).toBe('Expired');
  });

  // The ROW distinguishes what the CARD's bucket word cannot — this is the
  // whole of the 2026-09-01 change to `reportStatusLabel`.
  it('the row prints which open half the pass is actually in', () => {
    expect(reportStatusLabel(view({ status: 'matched', return_status: 'awaiting_return' })))
      .toBe('Out — Awaiting Return');
    expect(reportStatusLabel(view({ status: 'matched', return_status: 'partially_returned' })))
      .toBe('Partially Returned');
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

  // REWRITTEN 2026-08-22. It used to hold that both desks were subsets of the
  // "Partially Returned" bucket — which is exactly the defect the client
  // reported: an NRGP waiting for a signature was being counted under a return
  // obligation an NRGP cannot have. The two desks are subsets of the `pending`
  // bucket now, and the property being pinned is unchanged in kind: they narrow
  // ONE bucket rather than adding another.
  it('sums to the pending bucket\'s own waiting passes', () => {
    const both = [...ids(rows, 'pending_gate'), ...ids(rows, 'pending_approval')].sort();
    expect(both).toEqual(['a', 'b', 'c']);
    for (const id of both) {
      expect(ids(rows, 'pending')).toContain(id);
      expect(ids(rows, 'in_progress')).not.toContain(id);
    }
  });
});
