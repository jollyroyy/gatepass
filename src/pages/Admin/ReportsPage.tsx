// Reports — admin-only reporting centre with three "portals" (report views)
// sharing one date-range toolbar: All Passes (register), Return Schedule (RGP
// expected vs actual returns) and Department Summary (per-dept counts). All
// three derive from ONE loaded view set, filtered client-side by range —
// same single-load pattern the old AllPasses used for its filters. The KPI
// board moved to /admin-dashboard (024-era split: dashboard is the snapshot,
// this is the period report).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { computeDateRange, localDateString, localDayBounds, type RangePreset } from '../../lib/reportsDateRange';
import ReportsToolbar from './ReportsToolbar';
import ReportsFilterBar, { type TypeFilter } from './ReportsFilterBar';
import ReportsPrintHeader from '../../components/ReportsPrintHeader';
import AllPassesReport from './AllPassesReport';
import ReturnScheduleReport from './ReturnScheduleReport';
import DepartmentSummaryReport from './DepartmentSummaryReport';

type ReportView = 'all' | 'rgp' | 'dept';

const VIEWS: { key: ReportView; label: string }[] = [
  { key: 'all', label: 'All Passes' },
  { key: 'rgp', label: 'Return Schedule' },
  { key: 'dept', label: 'Department Summary' },
];

const SKELETON_ROWS = 8;
// Local (IST) date, not UTC — toISOString() would name yesterday before 05:30 IST.
const TODAY = localDateString(new Date());

export default function ReportsPage(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(TODAY);
  const [preset, setPreset] = useState<RangePreset>('today');
  const [view, setView] = useState<ReportView>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  // The active view reports how many rows it is actually showing (filters
  // applied), so the print header's count is the count that prints.
  const [displayCount, setDisplayCount] = useState(0);

  const range = useMemo(() => computeDateRange(preset, date), [preset, date]);

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

  // Client-side date filter: created_at within the inclusive range. Day
  // boundaries are LOCAL MIDNIGHT (localDayBounds), matching the
  // dashboard-period convention — the old UTC `T00:00:00Z..T23:59:59Z`
  // bounds made a "Today" report cover 05:30 IST yesterday to 05:29 IST
  // today, so it disagreed with every dashboard KPI for 5.5h per day.
  const ranged = useMemo(() => {
    const { start, end } = localDayBounds(range.from, range.to);
    return rows.filter((p) => {
      const created = new Date(p.created_at).getTime();
      return created >= start && created < end;
    });
  }, [rows, range]);

  // Department options come from the WHOLE loaded set, not `ranged` — a list
  // that reshuffles itself as the admin changes the date range would drop the
  // department they had selected out from under them.
  const deptOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of rows) map.set(p.department_id, p.department_name);
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // Scope filters are applied here, before any view sees a row, so the choice
  // holds across all three portals and prints identically from each.
  const scoped = useMemo(
    () =>
      ranged.filter((p) => {
        if (typeFilter !== 'all' && p.type !== typeFilter) return false;
        if (deptFilter !== 'all' && p.department_id !== deptFilter) return false;
        return true;
      }),
    [ranged, typeFilter, deptFilter],
  );

  function clearFilters() {
    setTypeFilter('all');
    setDeptFilter('all');
  }

  const viewLabel = VIEWS.find((v) => v.key === view)?.label ?? 'Report';
  const dateLabel = preset === 'today' ? range.to : `${range.from} to ${range.to}`;
  // A printed report filtered to one department must SAY so on the paper —
  // otherwise it reads as the whole org and undercounts by an unknowable amount.
  const scopeParts = [
    deptOptions.find((d) => d.id === deptFilter)?.name,
    typeFilter === 'all' ? null : typeFilter,
  ].filter(Boolean);
  const rangeLabel = scopeParts.length > 0 ? `${dateLabel} · ${scopeParts.join(' · ')}` : dateLabel;

  return (
    <div className="space-y-6 report-sheet">
      <div className="page-header">
        <h1 className="page-title">Reports</h1>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <ReportsToolbar
        date={date}
        today={TODAY}
        onDateChange={setDate}
        preset={preset}
        onPresetChange={setPreset}
        onPrint={() => window.print()}
      />

      <ReportsFilterBar
        typeFilter={typeFilter}
        onTypeChange={setTypeFilter}
        deptFilter={deptFilter}
        onDeptChange={setDeptFilter}
        deptOptions={deptOptions}
        onClear={clearFilters}
      />

      <div className="tab-group w-fit no-print">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            className={view === v.key ? 'tab-active' : 'tab-inactive'}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      <div className="print-only">
        <ReportsPrintHeader title={viewLabel} rangeLabel={rangeLabel} entryCount={displayCount} />
      </div>

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : view === 'all' ? (
        <AllPassesReport rows={scoped} onRowsChanged={setDisplayCount} />
      ) : view === 'rgp' ? (
        <ReturnScheduleReport rows={scoped} onRowsChanged={setDisplayCount} />
      ) : (
        <DepartmentSummaryReport rows={scoped} onRowsChanged={setDisplayCount} />
      )}

      <div className="print-only report-print-footer">
        <p className="report-print-meta">End of report · {displayCount} {displayCount === 1 ? 'pass' : 'passes'} · {viewLabel} · {rangeLabel}</p>
      </div>
    </div>
  );
}
