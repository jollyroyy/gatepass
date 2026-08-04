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
import { computeDateRange, type RangePreset } from '../../lib/reportsDateRange';
import ReportsToolbar from './ReportsToolbar';
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
const TODAY = new Date().toISOString().slice(0, 10);

export default function ReportsPage(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [date, setDate] = useState(TODAY);
  const [preset, setPreset] = useState<RangePreset>('today');
  const [view, setView] = useState<ReportView>('all');
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

  // Client-side date filter: created_at within the inclusive range. Same
  // day-boundary convention the VMS register uses (`T00:00:00Z`..`T23:59:59Z`).
  const ranged = useMemo(() => {
    const from = new Date(`${range.from}T00:00:00Z`).getTime();
    const to = new Date(`${range.to}T23:59:59Z`).getTime();
    return rows.filter((p) => {
      const created = new Date(p.created_at).getTime();
      return created >= from && created <= to;
    });
  }, [rows, range]);

  const viewLabel = VIEWS.find((v) => v.key === view)?.label ?? 'Report';
  const rangeLabel = preset === 'today' ? range.to : `${range.from} to ${range.to}`;

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
        <AllPassesReport rows={ranged} onRowsChanged={setDisplayCount} />
      ) : view === 'rgp' ? (
        <ReturnScheduleReport rows={ranged} onRowsChanged={setDisplayCount} />
      ) : (
        <DepartmentSummaryReport rows={ranged} onRowsChanged={setDisplayCount} />
      )}

      <div className="print-only report-print-footer">
        <p className="report-print-meta">End of report · {displayCount} {displayCount === 1 ? 'pass' : 'passes'} · {viewLabel} · {rangeLabel}</p>
      </div>
    </div>
  );
}
