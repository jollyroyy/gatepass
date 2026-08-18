// Reports — the admin's pass register, over a date range.
//
// ONE REPORT, NOT THREE. The Return Schedule and Department Summary portals
// were removed 2026-08-17 on the client's call, and the tab bar with them (a
// switcher with one option is a label). Neither loses a fact the admin cannot
// reach: expected vs actual return dates are columns of the register itself and
// the whole return loop is now the dashboard's Returnable Status ring and
// Overdue Returns panel, both drillable; per-department counts are the
// dashboard's Department Activity bar list, also drillable, where this page
// only ever printed a static table. `DeptBreakdownTable` was deleted with them
// — the Department Summary was its only consumer.
//
// Rows are loaded ONCE and filtered client-side by range, the single-load
// pattern the old AllPasses used. The KPI board is /admin-dashboard (024-era
// split: the dashboard is the snapshot, this is the period report).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { computeDateRange, localDateString, localDayBounds, type RangePreset } from '../../lib/reportsDateRange';
import ReportsToolbar from './ReportsToolbar';
import ReportsFilterBar, { type TypeFilter } from './ReportsFilterBar';
import ReportsPrintHeader from '../../components/ReportsPrintHeader';
import AllPassesReport from './AllPassesReport';
import { IS_OPEN_RETURN } from '../../lib/boardDrills';

/** What the printed sheet and its footer call this report. */
const REPORT_TITLE = 'Gate Pass Register';

const SKELETON_ROWS = 8;
// Local (IST) date, not UTC — toISOString() would name yesterday before 05:30 IST.
const TODAY = localDateString(new Date());

export default function ReportsPage(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(TODAY);
  const [preset, setPreset] = useState<RangePreset>('today');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [overdueOnly, setOverdueOnly] = useState(false);
  // The register reports how many rows it is actually showing (its own search
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

  // Scope filters are applied here, before the register sees a row, so the
  // choice holds on screen and on the printed sheet alike.
  const scoped = useMemo(
    () =>
      ranged.filter((p) => {
        if (typeFilter !== 'all' && p.type !== typeFilter) return false;
        if (deptFilter !== 'all' && p.department_id !== deptFilter) return false;
        // Overdue means material still out AND past its date. `is_overdue`
        // comes off `v_gate_passes` in the site's timezone and is NEVER
        // recomputed here; `IS_OPEN_RETURN` is the same open-return map the
        // boards use, so a returned pass cannot appear under this button.
        if (overdueOnly && !(IS_OPEN_RETURN[p.return_status] && p.is_overdue)) return false;
        return true;
      }),
    [ranged, typeFilter, deptFilter, overdueOnly],
  );

  function clearFilters() {
    setTypeFilter('all');
    setDeptFilter('all');
    setOverdueOnly(false);
  }

  const dateLabel = preset === 'today' ? range.to : `${range.from} to ${range.to}`;
  // A printed report filtered to one department must SAY so on the paper —
  // otherwise it reads as the whole org and undercounts by an unknowable amount.
  const scopeParts = [
    deptOptions.find((d) => d.id === deptFilter)?.name,
    typeFilter === 'all' ? null : typeFilter,
    overdueOnly ? 'Overdue only' : null,
  ].filter(Boolean);
  const rangeLabel = scopeParts.length > 0 ? `${dateLabel} · ${scopeParts.join(' · ')}` : dateLabel;

  return (
    <div className="space-y-6 report-sheet">
      <div className="page-header flex flex-wrap items-center justify-between gap-4">
        <h1 className="page-title">Reports</h1>
        <ReportsFilterBar
          typeFilter={typeFilter}
          onTypeChange={setTypeFilter}
          deptFilter={deptFilter}
          onDeptChange={setDeptFilter}
          deptOptions={deptOptions}
          overdueOnly={overdueOnly}
          onOverdueChange={setOverdueOnly}
          onClear={clearFilters}
        />
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

      <div className="print-only">
        <ReportsPrintHeader title={REPORT_TITLE} rangeLabel={rangeLabel} entryCount={displayCount} />
      </div>

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : (
        <AllPassesReport rows={scoped} onRowsChanged={setDisplayCount} />
      )}

      <div className="print-only report-print-footer">
        <p className="report-print-meta">End of report · {displayCount} {displayCount === 1 ? 'pass' : 'passes'} · {REPORT_TITLE} · {rangeLabel}</p>
      </div>
    </div>
  );
}
