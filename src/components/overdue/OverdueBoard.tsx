// OVERDUE ITEMS — the whole page, shared by the guard, the HOD and the admin.
//
// One component, three consumers, for the same reason GateBoard is one
// component: the three differ ONLY in which rows they are handed. Duplicating
// this layout per role is how two dashboards drifted apart before.
//
//   /overdue  guard  — every missed date, site-wide.
//              HOD   — every missed date, own passes only (RLS + `raised_by`).
//              admin — every missed date, site-wide.
//
// THE GUARD'S DAY CUT IS GONE (client, 2026-08-19). It showed only lines that
// went late in the last 24 hours, so a pass three days late read "Total overdue
// 0" on this page while the return queue called it Overdue — the reader has to
// be able to trust one number against the other. A backlog is not a day figure.
//
// ONLY THE GATE RECORDS A RETURN. `canRecord` is the guard, and it is not a
// courtesy: `apply_item_returns` refuses anyone else, and a button that always
// fails is worse than no button. A tick still saves nothing on its own — the
// Record bar is the commit, because the RPC has no undo.
import React, { useMemo, useState } from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import {
  buildOverdueRows, overdueStats, overdueTrend, filterOverdue,
  departmentsOf, formatDelay, EMPTY_FILTERS,
  type OverdueFilterState,
} from '../../lib/overdueItems';
import { pageOf } from '../../lib/scheduledReturns';
import { recordItemReturns } from '../../lib/recordReturns';
import { safeErrorMessage } from '../../lib/errors';
import { downloadCsv } from '../../lib/exportUtils';
import { csvDate, csvText } from '../../lib/csvCells';
import OverdueStats from './OverdueStats';
import OverdueFilters from './OverdueFilters';
import OverdueTable from './OverdueTable';
import OverdueTrendPanel from './OverdueTrendPanel';
import OverdueDeptChart from './OverdueDeptChart';

/** Five rows above the fold on the tablet at the gate — the same page size the
 *  Scheduled Returns table uses. */
const PAGE_SIZE = 5;

type Props = {
  subtitle: string;
  passes: GatePassView[];
  items: GatePassItemView[];
  canRecord: boolean;
  loading: boolean;
  error: string | null;
  /** A return landed — the page's own query must re-run, since the database may
   *  have just closed a pass. */
  onRecorded: () => void;
  /** The department ranking — admin only. An HOD's page is one department by
   *  construction, and a guard chases a line, not a department. */
  showDepartments?: boolean;
  /** The seven-day trend, and the "longest delay in this list" footnote.
   *
   *  OFF FOR THE GUARD (client, 2026-08-19). Both are figures about the shape
   *  of a backlog, which is a question an HOD or an admin asks; a guard is
   *  looking for the line in front of them and acts on the table alone. The
   *  escalation card is NOT part of this — it names items to chase, which is
   *  exactly the guard's job, so it stays on every role's page. */
  showTrend?: boolean;
};

export default function OverdueBoard({
  subtitle, passes, items, canRecord, loading, error, onRecorded,
  showDepartments = false, showTrend = true,
}: Props): React.ReactElement {
  const [filters, setFilters] = useState<OverdueFilterState>(EMPTY_FILTERS);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const rows = useMemo(() => buildOverdueRows(passes, items), [passes, items]);
  const stats = overdueStats(rows);
  const bars = useMemo(() => overdueTrend(rows), [rows]);

  const shown = useMemo(() => filterOverdue(rows, filters), [rows, filters]);
  const view = pageOf(shown, page, PAGE_SIZE);
  const chosen = shown.filter((r) => picked.has(r.item.id));

  function applyFilters(next: OverdueFilterState) {
    setFilters(next);
    setPage(1);
  }

  function toggle(itemId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  async function record() {
    setBusy(true);
    setActionError(null);
    try {
      await recordItemReturns(chosen);
      setPicked(new Set());
      onRecorded();
    } catch (err) {
      setActionError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // The export is what the table shows, filters and all — the rule for every
  // CSV in this app.
  function exportCsv() {
    downloadCsv(`overdue-items-${new Date().toISOString().slice(0, 10)}.csv`, shown, [
      { key: 'item', header: 'Item', format: (r) => csvText(r.item.name) },
      { key: 'pass', header: 'Gate Pass', format: (r) => csvText(r.pass.pass_number) },
      { key: 'carried_by', header: 'Carried By', format: (r) => csvText(r.pass.visitor_name) },
      { key: 'department', header: 'Department', format: (r) => csvText(r.pass.department_name) },
      { key: 'expected', header: 'Expected Return', format: (r) => csvDate(r.expectedReturn) },
      { key: 'outstanding', header: 'Outstanding Qty', format: (r) => String(r.item.outstanding_qty) },
      { key: 'unit', header: 'Unit', format: (r) => csvText(r.item.unit) },
      { key: 'delay', header: 'Days Late', format: (r) => String(r.daysLate) },
      { key: 'status', header: 'Status', format: (r) => (r.severity === 'critical' ? 'Critical' : 'Overdue') },
    ]);
  }

  return (
    <div>
      <div className="page-header flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="page-title">Overdue Items</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && stats.total > 0 && (
            <span className="status-badge bg-flagged-50 text-flagged-700">
              <span className="w-1.5 h-1.5 rounded-full bg-flagged-500" />
              {stats.total} {stats.total === 1 ? 'item' : 'items'} overdue
            </span>
          )}
          <button type="button" className="btn-secondary" onClick={exportCsv} disabled={shown.length === 0}>
            Export report
          </button>
        </div>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}
      {actionError && <div className="alert-error mb-4">{actionError}</div>}

      <OverdueStats stats={stats} loading={loading} />

      {loading ? (
        <div className="skeleton h-64 w-full" />
      ) : rows.length === 0 ? (
        <div className="card empty-state">
          <p>Nothing is overdue. Every returnable pass in scope is back or still within its date.</p>
        </div>
      ) : (
        /* 8 / 4 of twelve, like the boards: the table has nine columns and
           scrolls sideways any narrower; the trend is a fixed panel. */
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-8 min-w-0 flex flex-col gap-4">
            <OverdueFilters
              value={filters}
              departments={departmentsOf(rows)}
              onChange={applyFilters}
              onClear={() => applyFilters(EMPTY_FILTERS)}
            />

            {shown.length === 0 ? (
              <div className="card empty-state">
                <p>No overdue item matches these filters.</p>
              </div>
            ) : (
              <OverdueTable
                page={view}
                units={shown.map((r) => r.item.unit)}
                picked={picked}
                onToggle={toggle}
                onPage={setPage}
                busy={busy}
                canRecord={canRecord}
              />
            )}

            {/* Appears only once something is ticked — the commit step the tap
                deliberately is not. */}
            {chosen.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 card px-5 py-3">
                <p className="text-sm text-navy-700">
                  <span className="font-semibold">{chosen.length}</span>{' '}
                  {chosen.length === 1 ? 'line' : 'lines'} marked returned — not saved yet. A recorded
                  return cannot be undone.
                </p>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setPicked(new Set())} disabled={busy}>
                    Clear
                  </button>
                  <button
                    type="button"
                    data-testid="record-overdue-returns"
                    className="btn-primary"
                    onClick={() => void record()}
                    disabled={busy}
                  >
                    {busy ? 'Recording…' : `Record ${chosen.length} ${chosen.length === 1 ? 'return' : 'returns'}`}
                  </button>
                </div>
              </div>
            )}

            {showTrend && stats.total > 0 && (
              <p className="text-[11px] text-navy-500">
                Longest delay in this list: {formatDelay(Math.max(...rows.map((r) => r.daysLate)))}.
              </p>
            )}
          </div>

          <div className="xl:col-span-4 min-w-0 flex flex-col gap-4">
            {showDepartments && <OverdueDeptChart rows={rows} />}
            <OverdueTrendPanel
              bars={bars}
              showTrend={showTrend}
              critical={stats.critical}
              onReviewCritical={() => applyFilters({ ...filters, delay: 'critical' })}
            />
          </div>
        </div>
      )}
    </div>
  );
}
