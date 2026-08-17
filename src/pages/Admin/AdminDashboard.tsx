// Admin Dashboard — the org-wide operational board.
//
// Rebuilt 2026-08-17 to the client's reference layout: five headline KPIs, a
// category/status donut, a daily trend, an activity feed, the pending queue, a
// department ranking, the top materials, the return-loop donut and the overdue
// list.
//
// THE INVARIANT SURVIVED THE REBUILD AND WAS WIDENED TO THE CHARTS. Every
// clickable figure on this page — card, donut slice, bar, or day on the trend
// line — resolves to an `AdminDrill` that CARRIES the rows it counted, and the
// panel below renders exactly that array. There is no second `count: 'exact'`
// query and no predicate re-applied against a different array anywhere on the
// board, which is the only way a chart and the list behind it can be guaranteed
// to agree. Do not "optimise" any of this into aggregate queries.
//
// Two reads, both on mount:
//   v_gate_passes      — every KPI, chart and list.
//   v_gate_pass_items  — Top Materials only. An admin passes `is_security()`,
//                        so `gate_pass_items_select` (013) shows them every
//                        line org-wide, the same scope they already have on the
//                        passes themselves.
//
// Scope: the period filter (default Today) applies to everything EXCEPT the
// trend chart, which carries its own window, and the overdue panel, which is
// all-time. Both say so on the card — see their own files for why.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, GatePassItemView } from '../../types';
import DrillList from '../../components/DrillList';
import { safeErrorMessage } from '../../lib/errors';
import {
  periodBounds,
  previousPeriodBounds,
  PERIOD_COMPARISON_LABEL,
  type DashboardPeriod,
} from '../../lib/dashboardPeriod';
import DashboardPeriodFilter from '../../components/DashboardPeriodFilter';
import { ADMIN_KPIS, drillDefOf, kpiDrill, IS_OPEN_RETURN, type AdminDrill } from '../../lib/adminDrills';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import AdminKpiRow from './AdminKpiRow';
import AdminOverviewCard from './AdminOverviewCard';
import AdminTrendCard from './AdminTrendCard';
import AdminActivityFeed from './AdminActivityFeed';
import AdminPendingTable from './AdminPendingTable';
import AdminBreakdownCards from './AdminBreakdownCards';
import AdminOverdueList from './AdminOverdueList';

export default function AdminDashboard(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<AdminDrill | null>(null);
  const [period, setPeriod] = useState<DashboardPeriod>('today');

  const load = useCallback(async () => {
    setLoading(true);
    // Cleared UP FRONT, never on the success path: a refresh that resolves in
    // the same microtask queue as a failed action would otherwise wipe the
    // banner before it ever rendered (the 2026-08-13 BlacklistTab bug).
    setError(null);
    try {
      const [passRes, itemRes] = await Promise.all([
        gp().from('v_gate_passes').select('*'),
        gp().from('v_gate_pass_items').select('*'),
      ]);
      if (passRes.error) throw passRes.error;
      setRows((passRes.data as GatePassView[] | null) ?? []);
      // Top Materials is the only consumer, and a board that refuses to render
      // because ONE panel's query failed is worse than a board with one empty
      // panel. Items failing is therefore not fatal.
      setItems(itemRes.error ? [] : ((itemRes.data as GatePassItemView[] | null) ?? []));
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Scoped once, here, so every number below comes from the same array.
  const { scoped, previous } = useMemo(() => {
    const cur = periodBounds(period);
    const prev = previousPeriodBounds(period);
    const within = (p: GatePassView, b: { start: number; end: number }) => {
      const t = new Date(p.created_at).getTime();
      return t >= b.start && t < b.end;
    };
    return {
      scoped: rows.filter((p) => within(p, cur)),
      previous: rows.filter((p) => within(p, prev)),
    };
  }, [rows, period]);

  // The one all-time list on the board. See AdminOverdueList for why.
  const overdueAllTime = useMemo(
    () => rows.filter((p) => IS_OPEN_RETURN[p.return_status] && p.is_overdue),
    [rows],
  );
  const pending = useMemo(() => scoped.filter(ADMIN_KPIS.pending.match), [scoped]);

  // Toggling: clicking the thing already open closes it. Compared by `key`,
  // not by object identity — every render builds fresh drill objects.
  const select = useCallback((next: AdminDrill) => {
    setDrill((cur) => (cur?.key === next.key ? null : next));
  }, []);

  const activeKey = drill?.key ?? null;
  const resultsRef = useScrollIntoViewOnChange<HTMLDivElement>(activeKey);

  return (
    <div>
      <div className="page-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Overview of all gate pass activity, org-wide.</p>
        </div>
        <DashboardPeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <p className="text-[11px] text-navy-500 mb-3">
        Older passes are in <Link to="/all-passes" className="link-inline">Reports</Link>.
      </p>

      <AdminKpiRow
        scoped={scoped}
        previous={previous}
        all={rows}
        loading={loading}
        comparisonLabel={PERIOD_COMPARISON_LABEL[period]}
        activeKey={activeKey}
        onSelect={select}
      />

      {/* The drill panel sits directly under the KPIs rather than at the foot of
          the page: it is opened from anywhere on the board, and a reader who
          clicked a bar at the bottom should not have to hunt for where the
          answer appeared. `useScrollIntoViewOnChange` brings it into view. */}
      {drill && (
        <div ref={resultsRef} className="mt-8" role="region" aria-label="Selected passes">
          <DrillList def={drillDefOf(drill)} rows={drill.rows} loading={loading} />
        </div>
      )}

      {/* A 12-column grid, not three equal thirds: the trend line needs the
          most room (it plots up to 30 buckets) and the activity feed the least
          (one line per row). Equal thirds squeezed the chart and left the feed
          half empty. */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mt-8">
        <div className="xl:col-span-4 min-w-0">
          <AdminOverviewCard rows={scoped} loading={loading} activeKey={activeKey} onSelect={select} />
        </div>
        <div className="xl:col-span-5 min-w-0">
          <AdminTrendCard rows={rows} loading={loading} activeKey={activeKey} onSelect={select} />
        </div>
        <div className="xl:col-span-3 min-w-0">
          <AdminActivityFeed rows={scoped} loading={loading} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mt-4">
        <div className="xl:col-span-8 min-w-0">
          <AdminPendingTable
            rows={pending}
            loading={loading}
            active={activeKey === kpiDrill('pending', pending).key}
            onDrill={() => select(kpiDrill('pending', pending))}
          />
        </div>
        <div className="xl:col-span-4 min-w-0">
        <AdminOverdueList
          rows={overdueAllTime}
          loading={loading}
          active={activeKey === OVERDUE_ALL_TIME.key}
          onDrill={() => select({ ...OVERDUE_ALL_TIME, rows: overdueAllTime })}
        />
        </div>
      </div>

      <AdminBreakdownCards
        rows={scoped}
        items={items}
        loading={loading}
        activeKey={activeKey}
        onSelect={select}
      />
    </div>
  );
}

/** Its own drill key, distinct from the period-scoped `Overdue Returns` KPI —
 *  the two lists genuinely differ, and sharing a key would make clicking one
 *  silently close the other while showing different rows under the same
 *  heading. */
const OVERDUE_ALL_TIME: AdminDrill = {
  key: 'overdue-all-time',
  heading: 'Past their return date (all time)',
  empty: 'Nothing is overdue.',
  rows: [],
};
