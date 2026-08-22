// NOTHING THAT NEVER LEFT THE GATE READS "Partially Returned", AND NO NRGP EVER
// READS IT AT ALL.
//
// Client, 2026-08-22: "when I am searching with the partial return, both NRGPs
// are also coming. Partial return can only be true for the RGP, so make sure you
// don't show any NRGP under the partial return. I am not sure what those NRGP
// mean for partial return — if they are waiting for the gate for approval then
// put them under pending gate approval. Don't put them under partial return, and
// make this work across all the views, not only in the report but also in the HOD
// report and everywhere. We get from the past raised passes also accordingly."
//
// The defect was one arm of `reportStatusOf`: the "Partially Returned" bucket was
// the REMAINDER — everything that was neither completed nor cancelled — so every
// pass still climbing the ladder or waiting at the barrier fell into it, NRGP
// included. A return leg is the one thing an NRGP does not have (`return_status`
// is pinned to 'not_applicable' for it by `gate_passes_return_status_rgp_only`,
// migration 001), so the bucket was describing an obligation that cannot exist.
//
// The fix is a FOURTH bucket, `pending`, and a "Partially Returned" bucket that
// now tests the return leg POSITIVELY rather than by subtraction. The four are
// still disjoint and total, so the report's cards still add up. It is a
// derivation over `v_gate_passes`, so it re-files every pass ever raised the
// moment it is deployed — nothing is backfilled and no migration is needed.
import { describe, it, expect } from 'vitest';
import type { GatePassView, PassStatus, ReturnStatus } from '../../src/types';
import {
  applyReportFilters,
  buildReportKpis,
  REPORT_STATUS_LABELS,
  reportStatusLabel,
  reportStatusOf,
  reportStatusPill,
  STATUS_FILTERS,
  type ReportFilters,
} from '../../src/lib/gatePassReport';

function row(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260820-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering',
    raised_by: 'u1', raised_by_name: 'HOD One', created_at: '2026-08-20T04:00:00Z',
    is_overdue: false, is_expired: false, item_count: 1, total_value: 0,
    purpose: null, material_summary: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ALL: ReportFilters = {
  from: '2026-08-01', to: '2026-08-31', type: 'all', status: 'all', createdBy: '', department: '',
};

const STATUSES: PassStatus[] = [
  'pending', 'held', 'matched', 'flagged', 'hod_reviewed', 'cancelled',
];

describe('no NRGP is ever counted or labelled as partially returned', () => {
  // An NRGP can only ever be `not_applicable` — the CHECK constraint sees to
  // that — so walking every status with that one return status walks every NRGP
  // this database can hold.
  it('files no NRGP under the Partially Returned bucket, at any status', () => {
    for (const status of STATUSES) {
      for (const expired of [false, true]) {
        const p = row({ type: 'NRGP', status, is_expired: expired });
        expect(reportStatusOf(p), `${status} expired=${expired}`).not.toBe('in_progress');
      }
    }
  });

  it('never prints the words on an NRGP row', () => {
    for (const status of STATUSES) {
      const label = reportStatusLabel(row({ type: 'NRGP', status }));
      expect(label, status).not.toBe(REPORT_STATUS_LABELS.in_progress);
    }
  });

  it('returns no NRGP from the Partially Returned filter — the client search', () => {
    const rows = [
      row({ id: 'nrgp-pending', type: 'NRGP', status: 'pending' }),
      row({ id: 'nrgp-approval', type: 'NRGP', status: 'pending', awaits_approval: true }),
      row({ id: 'nrgp-done', type: 'NRGP', status: 'matched' }),
      row({ id: 'rgp-out', type: 'RGP', status: 'matched', return_status: 'awaiting_return' }),
      row({ id: 'rgp-half', type: 'RGP', status: 'matched', return_status: 'partially_returned' }),
      row({ id: 'rgp-pending', type: 'RGP', status: 'pending' }),
    ];
    const ids = applyReportFilters(rows, { ...ALL, status: 'in_progress' }).map((p) => p.id);
    expect(ids).toEqual(['rgp-out', 'rgp-half']);
  });
});

describe('a pass that has not been through the gate is PENDING, not partially returned', () => {
  it('files both desks and both types under the pending bucket', () => {
    expect(reportStatusOf(row({ type: 'NRGP', status: 'pending' }))).toBe('pending');
    expect(reportStatusOf(row({ type: 'RGP', status: 'pending' }))).toBe('pending');
    expect(reportStatusOf(row({ type: 'RGP', status: 'pending', awaits_approval: true }))).toBe('pending');
    expect(reportStatusOf(row({ status: 'held' }))).toBe('pending');
    expect(reportStatusOf(row({ status: 'hod_reviewed' }))).toBe('pending');
  });

  // The row names the desk the pass is actually sitting on, in the SAME words
  // every badge in the app already uses — `passStageStyle`'s own labels, so the
  // register and the card above it cannot disagree.
  it('names the desk on the row: gate review, or the ladder', () => {
    expect(reportStatusLabel(row({ type: 'NRGP', status: 'pending' }))).toBe('Pending Gate Review');
    expect(reportStatusLabel(row({ type: 'NRGP', status: 'pending', awaits_approval: true })))
      .toBe('Pending Approval');
    expect(reportStatusLabel(row({ status: 'held' }))).toBe('Held at Gate');
    expect(reportStatusPill(row({ status: 'pending' }))).toBe('gb-pill-orange');
  });

  // Expiry and the two refusals still outrank the desk — a dead pass is not
  // waiting on anybody.
  it('leaves the cancelled bucket alone', () => {
    expect(reportStatusOf(row({ type: 'NRGP', status: 'pending', is_expired: true }))).toBe('cancelled');
    expect(reportStatusOf(row({ type: 'NRGP', status: 'flagged' }))).toBe('cancelled');
    expect(reportStatusOf(row({ type: 'NRGP', status: 'cancelled' }))).toBe('cancelled');
  });
});

describe('the buckets are still disjoint and total', () => {
  it('counts every pass exactly once across the four', () => {
    const rows: GatePassView[] = [];
    const returns: ReturnStatus[] = [
      'not_applicable', 'awaiting_return', 'partially_returned', 'returned',
    ];
    let n = 0;
    for (const status of STATUSES) {
      for (const return_status of returns) {
        for (const is_expired of [false, true]) {
          rows.push(row({ id: `r${n++}`, status, return_status, is_expired }));
        }
      }
    }
    const counts = { completed: 0, pending: 0, in_progress: 0, cancelled: 0 };
    for (const p of rows) counts[reportStatusOf(p)] += 1;
    expect(counts.completed + counts.pending + counts.in_progress + counts.cancelled)
      .toBe(rows.length);
  });

  it('adds the pending card to the figures, and they still sum to the total', () => {
    const rows = [
      row({ id: 'a', type: 'RGP' }),
      row({ id: 'b', type: 'NRGP', status: 'matched' }),
      row({ id: 'c', type: 'RGP', status: 'matched', return_status: 'awaiting_return' }),
      row({ id: 'd', type: 'NRGP', status: 'flagged' }),
    ];
    const cards = buildReportKpis(rows, [], 'last 30 days');
    const by = Object.fromEntries(cards.map((c) => [c.key, c.value]));
    expect(by.pending).toBe(1);
    expect(by.in_progress).toBe(1);
    expect(by.completed + by.pending + by.in_progress + by.cancelled).toBe(by.total);
  });

  it('offers the pending bucket on the Status select', () => {
    expect(STATUS_FILTERS.find((s) => s.key === 'pending')?.label).toBe('Pending');
  });
});
