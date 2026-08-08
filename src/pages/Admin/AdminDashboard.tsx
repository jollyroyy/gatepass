// Admin Dashboard — today-only operational snapshot, not a period report.
// Every dashboard in this app shows only today's data; historical data lives
// in Reports (/all-passes), which has its own date-range toolbar. There is no
// `kpis()`-style RPC for a single day, so this page reads `v_gate_passes`
// directly (an admin's RLS scope is org-wide) and derives every number from
// one filtered array client-side — the same invariant the guard and HOD
// dashboards use: a KPI's count is always `rows.length` of the exact list
// behind it, never a second aggregate that could disagree.
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, ReturnStatus } from '../../types';
import KpiCard from '../../components/KpiCard';
import { safeErrorMessage } from '../../lib/errors';
import { periodBounds, type DashboardPeriod } from '../../lib/dashboardPeriod';
import DashboardPeriodFilter from '../../components/DashboardPeriodFilter';

/** A pass with one line still out is still an open obligation. Exact lookup,
 *  never `.includes()` on the enum. */
const IS_OPEN_RETURN: Record<ReturnStatus, boolean> = {
  not_applicable: false,
  awaiting_return: true,
  partially_returned: true,
  returned: false,
};

export default function AdminDashboard(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<DashboardPeriod>('today');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await gp().from('v_gate_passes').select('*');
      if (res.error) throw res.error;
      setRows((res.data as GatePassView[] | null) ?? []);
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

  // Selected period (default Today), applied once here so every KPI below is
  // derived from the same filtered array and cannot disagree with the number
  // it shows.
  const { start, end } = periodBounds(period);
  const scopedRows = rows.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= start && t < end;
  });

  const awaitingReturnRows = scopedRows.filter((p) => IS_OPEN_RETURN[p.return_status]);
  const overdueRows = awaitingReturnRows.filter((p) => p.is_overdue);
  // Return rate over the scoped rows: returned ÷ returnable (RGP passes only —
  // `not_applicable` NRGP rows never entered a return cycle at all).
  const returnableRows = scopedRows.filter((p) => p.return_status !== 'not_applicable');
  const returnedRows = returnableRows.filter((p) => p.return_status === 'returned');
  const returnRate = returnableRows.length > 0 ? Math.round((returnedRows.length / returnableRows.length) * 100) : 0;

  return (
    <div>
      <div className="page-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Admin Dashboard</h1>
          <p className="page-subtitle">Org-wide operational snapshot.</p>
        </div>
        <DashboardPeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-[11px] text-navy-400">
          Older passes are in <Link to="/all-passes" className="link-inline">Reports</Link>.
        </span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total" value={scopedRows.length} tone="neutral" loading={loading} />
        <KpiCard label="Awaiting Return" value={awaitingReturnRows.length} tone="brand" loading={loading} />
        <KpiCard label="Return Rate" value={`${returnRate}%`} tone="matched" loading={loading} />
        <KpiCard label="Overdue" value={overdueRows.length} tone="overdue" loading={loading} />
      </div>
    </div>
  );
}
