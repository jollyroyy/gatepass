// GATE PASS REPORT (RGP & NRGP) — the admin's Reports tab, rebuilt to the
// client's mock-up (2026-08-20): the header and its three buttons, the filter
// card, six figures, and the register with its pager.
//
// TWO COLUMNS THE MOCK DOES NOT DRAW ARE HERE ON THE CLIENT'S INSTRUCTION —
// Value of Items and Raised By Department — in the table and in the CSV alike.
//
// THE SKIN IS THE `.gb-*` ISLAND, not the house theme. Every screen in this app
// drawn from one of the client's mock-ups renders inside `.gb-board`, and this
// one now does too; `gb-main` rides beside it so any house component in the
// subtree takes its LIGHT half instead of the shipped dark default.
//
// ROWS ARE LOADED ONCE and everything below is a reading of that one array —
// the six figures, the two option lists, the table and the pager. No aggregate,
// no `count: 'exact'`, so a figure and the list under it cannot disagree.
//
// FILTERS ARE A DRAFT UNTIL APPLIED, because the mock draws an Apply Filters
// button (see ReportsFilterBar). The date range is applied first and in LOCAL
// day bounds — `localDayBounds`, the same cut every dashboard makes, or a
// "today" report and a "today" KPI disagree for five and a half hours a day.
//
// DELETED WITH THIS PASS, not flagged off: `AllPassesReport.tsx` (the old
// register) and `ReportsToolbar.tsx` (the date + preset strip the mock replaces
// with a range). Their column set moved to `src/lib/gatePassReport.ts`.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { localDateString, localDayBounds } from '../../lib/reportsDateRange';
import { downloadCsv } from '../../lib/exportUtils';
import {
  applyReportFilters,
  buildReportKpis,
  REPORT_CSV_COLUMNS,
  reportOptions,
  STATUS_FILTERS,
  TYPE_FILTERS,
  type ReportFilters,
} from '../../lib/gatePassReport';
import { pageOf } from '../../lib/scheduledReturns';
import { DEFAULT_ROWS_PER_PAGE } from '../../lib/pendingOutFilters';
import ReportsHeader from './ReportsHeader';
import ReportsFilterBar from './ReportsFilterBar';
import ReportsKpiCards from './ReportsKpiCards';
import ReportsTable from './ReportsTable';
import GuardPager from '../../components/guard/GuardPager';
import ReportsPrintHeader from '../../components/ReportsPrintHeader';

const REPORT_TITLE = 'Gate Pass Report (RGP & NRGP)';
const DAY_MS = 86_400_000;

// Local (IST) date, not UTC — toISOString() names yesterday before 05:30 IST.
const TODAY = localDateString(new Date());
/** The mock opens on a range, not a day: the last 30 days ending today. */
const OPENING: ReportFilters = {
  from: localDateString(new Date(Date.now() - 29 * DAY_MS)),
  to: TODAY,
  type: 'all',
  status: 'all',
  createdBy: '',
  department: '',
};

/** How many whole days the range covers, for the cards' "vs last N days" line. */
function spanDays(f: ReportFilters): number {
  const { start, end } = localDayBounds(f.from, f.to);
  return Math.max(1, Math.round((end - start) / DAY_MS));
}

function inRange(rows: GatePassView[], start: number, end: number): GatePassView[] {
  return rows.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= start && t < end;
  });
}

export default function ReportsPage(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<ReportFilters>(OPENING);
  const [draft, setDraft] = useState<ReportFilters>(OPENING);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_ROWS_PER_PAGE);
  // Stamped once at mount — see ReportsHeader for why it does not tick.
  const [stamp] = useState(() => new Date().toISOString());
  // A PRINTED REPORT IS THE WHOLE FILTERED SET, not page 3 of 25. The pager is
  // `no-print` chrome, but a row that never rendered cannot be hidden or shown
  // by CSS — so printing lifts the page size for exactly one paint and puts it
  // back. Nothing else in the app pages a printed sheet.
  const [printAll, setPrintAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: err } = await gp()
        .from('v_gate_passes')
        .select('*')
        .order('created_at', { ascending: false });
      if (err) throw err;
      setRows((data as GatePassView[] | null) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const options = useMemo(() => reportOptions(rows), [rows]);

  const bounds = useMemo(() => localDayBounds(applied.from, applied.to), [applied]);
  const scoped = useMemo(
    () => applyReportFilters(inRange(rows, bounds.start, bounds.end), applied),
    [rows, bounds, applied],
  );
  // The same-length window immediately before this one, narrowed the same way,
  // so each card's change is a like-for-like comparison.
  const previous = useMemo(() => {
    const span = bounds.end - bounds.start;
    return applyReportFilters(inRange(rows, bounds.start - span, bounds.start), applied);
  }, [rows, bounds, applied]);

  const days = spanDays(applied);
  const cards = useMemo(
    () => buildReportKpis(scoped, previous, `last ${days} days`),
    [scoped, previous, days],
  );

  const current = pageOf(scoped, printAll ? 1 : page, printAll ? Math.max(scoped.length, 1) : size);
  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  useEffect(() => {
    if (!printAll) return;
    window.print();
    setPrintAll(false);
  }, [printAll]);

  function apply(next: ReportFilters) {
    setApplied(next);
    setDraft(next);
    setPage(1);
  }

  // The printed sheet must SAY what it was narrowed to, or it reads as the whole
  // org and undercounts by an unknowable amount.
  const scopeParts = [
    applied.type === 'all' ? null : TYPE_FILTERS.find((t) => t.key === applied.type)?.label,
    applied.status === 'all' ? null : STATUS_FILTERS.find((s) => s.key === applied.status)?.label,
    options.createdBy.find((o) => o.id === applied.createdBy)?.name,
    options.departments.find((o) => o.id === applied.department)?.name,
  ].filter(Boolean);
  const dateLabel = applied.from === applied.to ? applied.to : `${applied.from} to ${applied.to}`;
  const rangeLabel = scopeParts.length > 0 ? `${dateLabel} · ${scopeParts.join(' · ')}` : dateLabel;

  return (
    <div className="gb-board gb-main report-sheet">
      <ReportsHeader
        stamp={stamp}
        onPrint={() => setPrintAll(true)}
        onExportCsv={() => downloadCsv('gate-pass-report.csv', scoped, REPORT_CSV_COLUMNS)}
      />

      {error && <div className="gb-alert">{error}</div>}

      <ReportsFilterBar
        draft={draft}
        onDraftChange={setDraft}
        createdByOptions={options.createdBy}
        deptOptions={options.departments}
        today={TODAY}
        dirty={dirty}
        onApply={() => apply(draft)}
        onReset={() => apply(OPENING)}
      />

      <div className="print-only">
        <ReportsPrintHeader title={REPORT_TITLE} rangeLabel={rangeLabel} entryCount={scoped.length} />
      </div>

      <ReportsKpiCards cards={cards} loading={loading} />

      <section className="gb-card gb-panel">
        {loading ? (
          <div className="gb-empty">
            <div className="gb-skeleton" />
          </div>
        ) : current.total === 0 ? (
          <div className="gb-empty">No passes match these filters.</div>
        ) : (
          <>
            <div className="gb-scroll">
              <ReportsTable rows={current.rows} />
            </div>
            <GuardPager
              page={current}
              size={size}
              onPage={setPage}
              onSize={(n) => {
                setSize(n);
                setPage(1);
              }}
            />
          </>
        )}
      </section>

      <div className="print-only report-print-footer">
        <p className="report-print-meta">
          End of report · {scoped.length} {scoped.length === 1 ? 'pass' : 'passes'} · {REPORT_TITLE} · {rangeLabel}
        </p>
      </div>
    </div>
  );
}
