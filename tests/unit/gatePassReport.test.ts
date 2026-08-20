// The report's derivations — the three buckets, the filters, the six figures and
// the cells (client's "Gate Pass Report (RGP & NRGP)" mock-up, 2026-08-20).
//
// The load-bearing property is that the buckets are DISJOINT AND TOTAL: the six
// cards only add up if every pass is counted exactly once, and a report whose
// figures do not add up is a report nobody can defend in a meeting.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  applyReportFilters,
  buildReportKpis,
  isNarrowed,
  isOverduePass,
  itemsLabel,
  purposeText,
  REPORT_CSV_COLUMNS,
  reportOptions,
  reportStatusLabel,
  reportStatusOf,
  reportStatusPill,
  valueText,
  type ReportFilters,
} from '../../src/lib/gatePassReport';

function row(over: Partial<GatePassView>): GatePassView {
  return {
    id: over.id ?? 'x',
    pass_number: over.pass_number ?? 'RGP-20260820-0001',
    type: over.type ?? 'RGP',
    direction: 'out',
    status: over.status ?? 'pending',
    return_status: over.return_status ?? 'not_applicable',
    department_id: over.department_id ?? 'd1',
    department_name: over.department_name ?? 'Engineering',
    raised_by: over.raised_by ?? 'u1',
    raised_by_name: over.raised_by_name ?? 'HOD One',
    created_at: over.created_at ?? '2026-08-20T04:00:00Z',
    is_overdue: over.is_overdue ?? false,
    is_expired: over.is_expired ?? false,
    item_count: over.item_count ?? 1,
    total_value: over.total_value ?? 0,
    purpose: over.purpose ?? null,
    material_summary: over.material_summary ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const ALL: ReportFilters = {
  from: '2026-08-01', to: '2026-08-31', type: 'all', status: 'all', createdBy: '', department: '',
};

describe('reportStatusOf — the three buckets', () => {
  it('calls a cleared NRGP completed: it is not coming back', () => {
    expect(reportStatusOf(row({ status: 'matched', return_status: 'not_applicable' }))).toBe('completed');
  });

  it('calls an RGP completed only once every line is back', () => {
    expect(reportStatusOf(row({ status: 'matched', return_status: 'awaiting_return' }))).toBe('in_progress');
    expect(reportStatusOf(row({ status: 'matched', return_status: 'partially_returned' }))).toBe('in_progress');
    expect(reportStatusOf(row({ status: 'matched', return_status: 'returned' }))).toBe('completed');
  });

  it('calls flagged and cancelled passes cancelled', () => {
    expect(reportStatusOf(row({ status: 'flagged' }))).toBe('cancelled');
    expect(reportStatusOf(row({ status: 'cancelled' }))).toBe('cancelled');
  });

  // `match_pass` refuses an expired pass forever, so it is dead paperwork rather
  // than work anybody is still waiting on.
  it('files an expired pass under cancelled, not in progress', () => {
    expect(reportStatusOf(row({ status: 'pending', is_expired: true }))).toBe('cancelled');
  });

  // Only meaningful while a pass is pending — a matched pass whose expiry has
  // passed was used in time.
  it('ignores is_expired on a pass that already reached an outcome', () => {
    expect(reportStatusOf(row({ status: 'matched', is_expired: true }))).toBe('completed');
  });

  it('calls an overdue pass in progress — late is not finished', () => {
    const late = row({ status: 'matched', return_status: 'awaiting_return', is_overdue: true });
    expect(reportStatusOf(late)).toBe('in_progress');
    expect(isOverduePass(late)).toBe(true);
  });

  // A returned pass cannot be overdue, whatever the view's flag says about the
  // date — the obligation closed.
  it('never calls a closed return overdue', () => {
    expect(isOverduePass(row({ return_status: 'returned', is_overdue: true }))).toBe(false);
  });

  it('is disjoint and total, so the six cards add up', () => {
    const rows = [
      row({ id: '1' }),
      row({ id: '2', status: 'matched' }),
      row({ id: '3', status: 'flagged' }),
      row({ id: '4', is_expired: true }),
      row({ id: '5', status: 'matched', return_status: 'awaiting_return', is_overdue: true }),
    ];
    const counts = { completed: 0, in_progress: 0, cancelled: 0 };
    for (const p of rows) counts[reportStatusOf(p)] += 1;
    expect(counts.completed + counts.in_progress + counts.cancelled).toBe(rows.length);
  });
});

describe('the row pill says more than its bucket where more is true', () => {
  it('reads Overdue and Expired in the attention hue', () => {
    const late = row({ status: 'matched', return_status: 'awaiting_return', is_overdue: true });
    const dead = row({ status: 'pending', is_expired: true });
    expect(reportStatusLabel(late)).toBe('Overdue');
    expect(reportStatusLabel(dead)).toBe('Expired');
    expect(reportStatusPill(late)).toBe('gb-pill-orange');
    expect(reportStatusPill(dead)).toBe('gb-pill-orange');
  });

  it('otherwise reads the mock\'s own three words', () => {
    expect(reportStatusLabel(row({ status: 'matched' }))).toBe('Completed');
    expect(reportStatusLabel(row({ status: 'pending' }))).toBe('In Progress');
    expect(reportStatusLabel(row({ status: 'flagged' }))).toBe('Cancelled');
    expect(reportStatusPill(row({ status: 'matched' }))).toBe('gb-pill-green');
  });
});

describe('applyReportFilters', () => {
  const rows = [
    row({ id: 'a', type: 'RGP', raised_by: 'u1', department_id: 'd1' }),
    row({ id: 'b', type: 'NRGP', raised_by: 'u2', department_id: 'd2', status: 'matched' }),
    row({ id: 'c', type: 'RGP', status: 'matched', return_status: 'awaiting_return', is_overdue: true }),
    row({ id: 'd', type: 'RGP', is_expired: true }),
  ];
  const ids = (f: Partial<ReportFilters>) =>
    applyReportFilters(rows, { ...ALL, ...f }).map((p) => p.id);

  it('passes everything through by default', () => {
    expect(ids({})).toEqual(['a', 'b', 'c', 'd']);
  });

  it('narrows by type, person and department', () => {
    expect(ids({ type: 'NRGP' })).toEqual(['b']);
    expect(ids({ createdBy: 'u2' })).toEqual(['b']);
    expect(ids({ department: 'd2' })).toEqual(['b']);
  });

  it('narrows by bucket', () => {
    expect(ids({ status: 'completed' })).toEqual(['b']);
    expect(ids({ status: 'in_progress' })).toEqual(['a', 'c']);
    expect(ids({ status: 'cancelled' })).toEqual(['d']);
  });

  // Both are subsets of a bucket, not buckets of their own.
  it('narrows to the overdue and expired subsets', () => {
    expect(ids({ status: 'overdue' })).toEqual(['c']);
    expect(ids({ status: 'expired' })).toEqual(['d']);
  });

  it('combines filters rather than replacing them', () => {
    expect(ids({ type: 'RGP', status: 'expired' })).toEqual(['d']);
    expect(ids({ type: 'NRGP', status: 'expired' })).toEqual([]);
  });

  // A report always covers some range, so the dates are not something Reset has
  // anything to clear.
  it('does not count the date range as a narrowing', () => {
    expect(isNarrowed(ALL)).toBe(false);
    expect(isNarrowed({ ...ALL, from: '2026-01-01' })).toBe(false);
    expect(isNarrowed({ ...ALL, status: 'overdue' })).toBe(true);
    expect(isNarrowed({ ...ALL, createdBy: 'u1' })).toBe(true);
  });
});

describe('reportOptions', () => {
  it('offers each person and department once, sorted by name', () => {
    const { createdBy, departments } = reportOptions([
      row({ raised_by: 'u2', raised_by_name: 'Zoya', department_id: 'd2', department_name: 'Retail' }),
      row({ raised_by: 'u1', raised_by_name: 'Amit', department_id: 'd1', department_name: 'Engineering' }),
      row({ raised_by: 'u1', raised_by_name: 'Amit', department_id: 'd1', department_name: 'Engineering' }),
    ]);
    expect(createdBy.map((o) => o.name)).toEqual(['Amit', 'Zoya']);
    expect(departments.map((o) => o.name)).toEqual(['Engineering', 'Retail']);
  });
});

describe('buildReportKpis', () => {
  const rows = [
    row({ id: 'a', type: 'RGP' }),
    row({ id: 'b', type: 'RGP', status: 'matched' }),
    row({ id: 'c', type: 'NRGP', status: 'flagged' }),
    row({ id: 'd', type: 'NRGP', status: 'matched' }),
  ];

  it('counts the mock\'s six figures, and they add up', () => {
    const cards = buildReportKpis(rows, [], 'last 30 days');
    const by = Object.fromEntries(cards.map((c) => [c.key, c.value]));
    expect(by.total).toBe(4);
    expect(by.rgp + by.nrgp).toBe(by.total);
    expect(by.completed + by.in_progress + by.cancelled).toBe(by.total);
  });

  it('prints the share of total on the two type cards', () => {
    const cards = buildReportKpis(rows, [], 'last 30 days');
    expect(cards.find((c) => c.key === 'rgp')?.note).toBe('50.00% of total');
    expect(cards.find((c) => c.key === 'nrgp')?.trend).toBe('none');
  });

  it('compares against the previous window, with a direction', () => {
    const up = buildReportKpis(rows, [row({ id: 'p' }), row({ id: 'q' })], 'last 30 days');
    expect(up[0].note).toBe('↑ 100% vs last 30 days');
    expect(up[0].trend).toBe('up');

    const down = buildReportKpis([row({ id: 'a' })], rows, 'last 30 days');
    expect(down[0].note).toBe('↓ 75% vs last 30 days');
    expect(down[0].trend).toBe('down');
  });

  // A change from nothing is not a number, and a red arrow beside an invented
  // figure is worse than a plain sentence.
  it('states no percentage when the previous window was empty', () => {
    const cards = buildReportKpis(rows, [], 'last 30 days');
    expect(cards[0].note).toBe('vs last 30 days');
    expect(cards[0].trend).toBe('none');
  });

  it('says so plainly when nothing changed', () => {
    const cards = buildReportKpis(rows, rows, 'last 30 days');
    expect(cards[0].note).toBe('No change vs last 30 days');
    expect(cards[0].trend).toBe('none');
  });
});

describe('the cells', () => {
  it('prints the purpose, falling back to the material summary', () => {
    expect(purposeText({ purpose: 'Tools for repair', material_summary: 'Drill' })).toBe('Tools for repair');
    expect(purposeText({ purpose: '   ', material_summary: 'Drill' })).toBe('Drill');
    expect(purposeText({ purpose: null, material_summary: null })).toBe('—');
  });

  it('counts items in the mock\'s own words', () => {
    expect(itemsLabel(1)).toBe('1 Item');
    expect(itemsLabel(6)).toBe('6 Items');
  });

  // "nothing was declared" is a different claim from "this is worth nothing".
  it('shows a dash for an unpriced pass, never ₹0', () => {
    expect(valueText(4500)).toBe('₹4,500');
    expect(valueText(0)).toBe('—');
    expect(valueText(null)).toBe('—');
  });

  it('exports the two columns the client added, with a blank rather than a dash', () => {
    const headers = REPORT_CSV_COLUMNS.map((c) => c.header);
    expect(headers).toContain('Value of Items');
    expect(headers).toContain('Raised By Department');

    const value = REPORT_CSV_COLUMNS.find((c) => c.header === 'Value of Items')!;
    // A dash in a value column breaks SUM in the spreadsheet it lands in.
    expect(value.format!(row({ total_value: 0 }))).toBe('');
    expect(value.format!(row({ total_value: 4500.4 }))).toBe('4500');
  });
});
