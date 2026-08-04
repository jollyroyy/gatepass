// Admin Dashboard — the org-wide operational snapshot, not a period report.
// Status counts (pending / matched / mismatched) live here as KPI cards
// alongside the return/overdue metrics; the full register and per-department
// breakdown still live under Reports (/all-passes).
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { PassKpis } from '../../types';
import { EMPTY_KPIS } from '../../types';
import KpiCard from '../../components/KpiCard';
import { safeErrorMessage } from '../../lib/errors';

interface KpiRow {
  total: number;
  pending: number;
  matched: number;
  flagged: number;
  awaiting_return: number;
  overdue: number;
  raised_today: number;
  overdue_value: number;
  flagged_rate: number;
  return_rate: number;
}

function mapKpiRow(row: KpiRow | undefined): PassKpis {
  if (!row) return EMPTY_KPIS;
  return {
    total: row.total ?? 0,
    pending: row.pending ?? 0,
    matched: row.matched ?? 0,
    flagged: row.flagged ?? 0,
    awaitingReturn: row.awaiting_return ?? 0,
    overdue: row.overdue ?? 0,
    raisedToday: row.raised_today ?? 0,
    overdueValue: row.overdue_value ?? 0,
    flaggedRate: row.flagged_rate ?? 0,
    returnRate: row.return_rate ?? 0,
  };
}

export default function AdminDashboard(): React.ReactElement {
  const [kpis, setKpis] = useState<PassKpis>(EMPTY_KPIS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const kpiRes = await gp().rpc('kpis', { p_department_id: null });
      if (kpiRes.error) throw kpiRes.error;
      const kpiRows = (kpiRes.data as KpiRow[] | null) ?? [];
      setKpis(mapKpiRow(kpiRows[0]));
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Admin Dashboard</h1>
        <p className="page-subtitle">Org-wide operational snapshot.</p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total"
          value={kpis.total}
          tone="neutral"
          loading={loading}
          delta={kpis.returnRate > 0 ? `${kpis.returnRate}% return rate` : kpis.raisedToday > 0 ? `▲ ${kpis.raisedToday} today` : undefined}
        />
        <KpiCard label="Pending for Gate Approval" value={kpis.pending} tone="pending" loading={loading} />
        <KpiCard label="Matched" value={kpis.matched} tone="matched" loading={loading} />
        <KpiCard label="Mismatched" value={kpis.flagged} tone="flagged" loading={loading} />
        <KpiCard label="Awaiting Return" value={kpis.awaitingReturn} tone="brand" loading={loading} />
        <KpiCard label="Return Rate" value={`${kpis.returnRate}%`} tone="matched" loading={loading} />
        <KpiCard label="Overdue" value={kpis.overdue} tone="overdue" loading={loading} delta={kpis.overdueValue > 0 ? `₹${kpis.overdueValue.toLocaleString('en-IN')} in value` : undefined} />
      </div>
    </div>
  );
}
