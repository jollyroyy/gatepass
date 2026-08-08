// Admin Dashboard — today-only operational snapshot, not a period report.
// Every dashboard in this app shows only today's data; historical data lives
// in Reports (/all-passes), which has its own date-range toolbar. There is no
// `kpis()`-style RPC for a single day, so this page reads `v_gate_passes`
// directly (an admin's RLS scope is org-wide) and derives every number from
// one filtered array client-side — the same invariant the guard and HOD
// dashboards use: a KPI's count is always `rows.length` of the exact list
// behind it, never a second aggregate that could disagree. Every KPI is a
// drill (2026-08-08): clicking it reveals those very rows beneath the grid.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import KpiCard from '../../components/KpiCard';
import DrillList from '../../components/DrillList';
import { safeErrorMessage } from '../../lib/errors';
import { periodBounds, type DashboardPeriod } from '../../lib/dashboardPeriod';
import DashboardPeriodFilter from '../../components/DashboardPeriodFilter';
import { ADMIN_DRILLS, ADMIN_DRILL_ORDER, type AdminDrillKey } from '../../lib/adminDrills';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';

export default function AdminDashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminDrillKey | null>(null);
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

  // One pass through `scopedRows` per drill — the KPI card's number and the
  // list its click opens come from the exact same array.
  const drillRows = {} as Record<AdminDrillKey, GatePassView[]>;
  for (const key of ADMIN_DRILL_ORDER) {
    drillRows[key] = scopedRows.filter(ADMIN_DRILLS[key].match);
  }

  // Return rate over the scoped rows: returned ÷ returnable (RGP passes only —
  // `not_applicable` NRGP rows never entered a return cycle at all).
  const returnableCount = scopedRows.filter((p) => p.return_status !== 'not_applicable').length;
  const returnRate = returnableCount > 0 ? Math.round((drillRows.returned.length / returnableCount) * 100) : 0;

  function toggleDrill(key: AdminDrillKey) {
    setSelected((cur) => (cur === key ? null : key));
  }

  const resultsRef = useScrollIntoViewOnChange<HTMLDivElement>(selected);

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
        <KpiCard
          label={ADMIN_DRILLS.total.label}
          value={drillRows.total.length}
          tone={ADMIN_DRILLS.total.tone}
          loading={loading}
          active={selected === 'total'}
          onClick={() => toggleDrill('total')}
        />
        <KpiCard
          label={ADMIN_DRILLS.awaiting.label}
          value={drillRows.awaiting.length}
          tone={ADMIN_DRILLS.awaiting.tone}
          loading={loading}
          active={selected === 'awaiting'}
          onClick={() => toggleDrill('awaiting')}
        />
        <KpiCard
          label={ADMIN_DRILLS.returned.label}
          value={`${returnRate}%`}
          tone={ADMIN_DRILLS.returned.tone}
          loading={loading}
          active={selected === 'returned'}
          onClick={() => toggleDrill('returned')}
        />
        <KpiCard
          label={ADMIN_DRILLS.overdue.label}
          value={drillRows.overdue.length}
          tone={ADMIN_DRILLS.overdue.tone}
          loading={loading}
          active={selected === 'overdue'}
          onClick={() => toggleDrill('overdue')}
        />
      </div>

      {selected && (
        <div ref={resultsRef} className="mt-8">
          <DrillList
            def={ADMIN_DRILLS[selected]}
            rows={drillRows[selected]}
            loading={loading}
            onOpen={(id) => navigate(`/pass/${id}`)}
          />
        </div>
      )}
    </div>
  );
}