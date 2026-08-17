// HOD Dashboard — the same board the admin gets, narrowed to one person.
//
// Rebuilt 2026-08-17 at the client's request: "put a similar type of dashboard
// for the individual HOD, but only for their department and only for her or
// him — all those pie charts, kept relevant."
//
// TWO SCOPES STACK HERE, AND ONLY ONE OF THEM IS THIS FILE'S DOING:
//
//   Department — RLS. `gate_passes_select` (002) shows an HOD only
//                `department_id in (select my_department_ids())`, and since
//                `032` a person holds at most one department. Nothing on this
//                page asks for that; it is the shape of the data that arrives.
//   Person     — `.eq('raised_by', userId)`, applied HERE, on every read. A
//                department may host more than one HOD, and the client asked
//                for this board to be their own. It is a SERVER-side filter on
//                purpose: a client-side one would download a colleague's passes
//                to hide them, and the count of what you filtered out is itself
//                information the reader did not ask for and cannot act on.
//
// The invariant is the admin board's, unchanged: every clickable figure — card,
// donut slice, bar, or day on the trend line — resolves to a `BoardDrill` that
// CARRIES the rows it counted, and the panel below renders exactly that array.
// No second `count: 'exact'` query, no predicate re-applied to a different
// array. See src/lib/boardDrills.ts.
//
// WHAT REPLACED THE TEN FLAT KPI CARDS, so nothing was silently dropped:
//   Total Raised / Pending / Matched / Awaiting / Overdue → the five headline
//     cards, which additionally carry a delta and a sparkline.
//   RGP Issued / NRGP Issued  → Gate Pass Overview, "By category".
//   Expired / Mismatched      → Gate Pass Overview, "By status". Expired ALSO
//     keeps its own banner below, because it is the one bucket that means
//     material the HOD authorised never moved.
//   Return Rate               → Returnable Status, which shows the same ratio
//     as three real drillable buckets instead of one percentage.
import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import DrillList from '../../components/DrillList';
import { isExpiredPending } from '../../lib/statusStyles';
import {
  periodBounds,
  previousPeriodBounds,
  PERIOD_COMPARISON_LABEL,
  type DashboardPeriod,
} from '../../lib/dashboardPeriod';
import DashboardPeriodFilter from '../../components/DashboardPeriodFilter';
import { BOARD_KPIS, drillDefOf, kpiDrill, IS_OPEN_RETURN, type BoardDrill } from '../../lib/boardDrills';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import BoardKpiRow from '../../components/board/BoardKpiRow';
import BoardOverviewCard from '../../components/board/BoardOverviewCard';
import BoardTrendCard from '../../components/board/BoardTrendCard';
import BoardActivityFeed from '../../components/board/BoardActivityFeed';
import BoardPendingTable from '../../components/board/BoardPendingTable';
import BoardOverdueList from '../../components/board/BoardOverdueList';
import HodBreakdownCards from './HodBreakdownCards';
import FlaggedReviewCard from './FlaggedReviewCard';
import { useHodBoardData, useMyDepartmentNames } from './useHodBoardData';

/** Where this board sends a reader for anything older or wider than the panel
 *  in front of them. NOT `/all-passes` — `ROLE_ROUTES` closes that to an HOD. */
const REGISTER = '/my-passes';

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const { rows, items, flagged, loading, error } = useHodBoardData();
  const deptNames = useMyDepartmentNames();
  const [drill, setDrill] = useState<BoardDrill | null>(null);
  const [period, setPeriod] = useState<DashboardPeriod>('today');

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

  // The one all-time list on the board. See BoardOverdueList for why.
  const overdueAllTime = useMemo(
    () => rows.filter((p) => IS_OPEN_RETURN[p.return_status] && p.is_overdue),
    [rows],
  );
  const pending = useMemo(() => scoped.filter(BOARD_KPIS.pending.match), [scoped]);
  const expired = useMemo(() => scoped.filter(isExpiredPending), [scoped]);

  // Toggling: clicking the thing already open closes it. Compared by `key`,
  // not by object identity — every render builds fresh drill objects.
  const select = useCallback((next: BoardDrill) => {
    setDrill((cur) => (cur?.key === next.key ? null : next));
  }, []);

  const activeKey = drill?.key ?? null;
  const resultsRef = useScrollIntoViewOnChange<HTMLDivElement>(activeKey);

  return (
    <div>
      <div className="page-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">
            {deptNames.length > 0 ? `${deptNames.join(' · ')} — passes you raised` : 'Passes you raised'}
          </p>
        </div>
        <DashboardPeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {/* Zero renders nothing — an empty red banner is noise. Expired lives in
          the overview donut's status mode as well; it keeps a banner of its own
          because it is the one bucket that means material this HOD authorised
          never moved and the paperwork is now dead. */}
      {expired.length > 0 && (
        <div className="bg-flagged-500/10 border-l-4 border-flagged-500 rounded-r-lg px-4 py-3 mb-6">
          <p className="text-sm font-semibold text-flagged-700">
            {expired.length} {expired.length === 1 ? 'pass' : 'passes'} expired without reaching the gate.
          </p>
        </div>
      )}

      <p className="text-[11px] text-navy-500 mb-3">
        Older passes are in{' '}
        <Link to={REGISTER} className="text-accent-600 hover:underline font-semibold">
          My Passes
        </Link>
        .
      </p>

      <BoardKpiRow
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
          answer appeared. `useScrollIntoViewOnChange` brings it into view.
          `showRaisedBy={false}` — the HOD raised every pass on this board by
          construction now, so their own name back at them is pure noise. */}
      {drill && (
        <div ref={resultsRef} className="mt-8" role="region" aria-label="Selected passes">
          <DrillList def={drillDefOf(drill)} rows={drill.rows} loading={loading} showRaisedBy={false} />
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mt-8">
        <div className="xl:col-span-4 min-w-0">
          <BoardOverviewCard rows={scoped} loading={loading} activeKey={activeKey} onSelect={select} />
        </div>
        <div className="xl:col-span-5 min-w-0">
          <BoardTrendCard rows={rows} loading={loading} activeKey={activeKey} onSelect={select} />
        </div>
        <div className="xl:col-span-3 min-w-0">
          <BoardActivityFeed rows={scoped} loading={loading} viewAllTo={REGISTER} />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mt-4">
        <div className="xl:col-span-8 min-w-0">
          <BoardPendingTable
            rows={pending}
            loading={loading}
            viewAllTo={REGISTER}
            /* One department, one repeated word — see HodBreakdownCards. */
            showDepartment={false}
            active={activeKey === kpiDrill('pending', pending).key}
            onDrill={() => select(kpiDrill('pending', pending))}
          />
        </div>
        <div className="xl:col-span-4 min-w-0">
          <BoardOverdueList
            rows={overdueAllTime}
            loading={loading}
            active={activeKey === OVERDUE_ALL_TIME.key}
            onDrill={() => select({ ...OVERDUE_ALL_TIME, rows: overdueAllTime })}
          />
        </div>
      </div>

      <HodBreakdownCards
        rows={scoped}
        items={items}
        loading={loading}
        activeKey={activeKey}
        onSelect={select}
      />

      {/* Fed by the UNSCOPED flagged fetch, never `scoped` — a mismatch raised
          yesterday still needs this HOD's decision today, and the Today toggle
          must not hide an open action item. Below the charts because it is a
          task list, not a measurement. */}
      {!loading && (
        <div className="mt-8">
          <FlaggedReviewCard rows={flagged} onOpen={(id) => navigate(`/pass/${id}`)} />
        </div>
      )}
    </div>
  );
}

/** Its own drill key, distinct from the period-scoped `Overdue Returns` KPI —
 *  the two lists genuinely differ, and sharing a key would make clicking one
 *  silently close the other while showing different rows under the same
 *  heading. */
const OVERDUE_ALL_TIME: BoardDrill = {
  key: 'overdue-all-time',
  heading: 'Past their return date (all time)',
  empty: 'Nothing is overdue.',
  rows: [],
};
