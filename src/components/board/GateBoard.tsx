// THE GATE PASS MANAGEMENT BOARD — the whole dashboard, rebuilt 2026-08-17 to the
// client's reference layout and shared by the admin and the HOD.
//
// One component, two consumers, because the two boards differ only in WHICH ROWS
// they are handed and where their "view all" links point. Duplicating this layout
// per role is how the two dashboards drifted apart before.
//
//   /admin-dashboard  every pass in the org (RLS gives an admin all departments).
//   /dashboard        one HOD's own passes — department scope is RLS's, person
//                     scope is `.eq('raised_by', …)` in useHodBoardData.ts.
//
// THE INVARIANT, UNCHANGED THROUGH THE REBUILD: every clickable figure on this
// page — tile, ring segment, bar, tab, day on the trend line — resolves to a
// `BoardDrill` that CARRIES the rows it counted, and the panel below renders
// exactly that array. There is no `count: 'exact'` query anywhere on this board
// and no predicate re-applied against a second array. Do not "optimise" this into
// aggregate queries: a figure that disagrees with the list its own click opens is
// invisible to the eye and fatal to trust.
//
// TWO KINDS OF SCOPE LIVE ON THIS PAGE, and mixing them up is the mistake this
// layout is arranged to prevent:
//
//   PERIOD-SCOPED — the "issued" / "cleared" / "returned" figures, and the Quick
//                   Summary's volume tiles. They answer "what happened in the
//                   selected window" and carry a delta against the window before.
//   CURRENT-STATE — everything about open obligations: outside, due, overdue, the
//                   status ring, the return watch, and the queue counts. They are
//                   NOT period-scoped, because an obligation does not stop being
//                   open because the calendar rolled past the window it started
//                   in. Every one of those panels says "all time" on itself.
//
// The category TOGGLE the board used to carry is gone: RGP and NRGP now have their
// own sections, which is the same information without asking the reader to press a
// button to discover the other half of it.
import React, { useCallback, useMemo, useState } from 'react';
import type { GatePassView, GatePassItemView } from '../../types';
import DrillList from '../DrillList';
import {
  periodBounds,
  previousPeriodBounds,
  PERIOD_COMPARISON_LABEL,
  type DashboardPeriod,
} from '../../lib/dashboardPeriod';
import { RGP_SECTION, NRGP_SECTION, SUMMARY_SECTION, type BoardWindows } from '../../lib/boardKpis';
import { drillDefOf, IS_OPEN_RETURN, type BoardDrill } from '../../lib/boardDrills';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import BoardHeader from './BoardHeader';
import BoardKpiSection from './BoardKpiSection';
import BoardMovementTrend from './BoardMovementTrend';
import BoardStatusBreakdown from './BoardStatusBreakdown';
import BoardReturnWatch from './BoardReturnWatch';
import BoardOutstanding, { type OutstandingMode } from './BoardOutstanding';
import BoardActivityTimeline from './BoardActivityTimeline';

type Props = {
  title: string;
  subtitle: string;
  /** Every pass the reader may see. Windowing happens here, once. */
  rows: GatePassView[];
  items: GatePassItemView[];
  loading: boolean;
  error: string | null;
  /** The register this reader is allowed to open — `/all-passes` is admin-only. */
  registerTo: string;
  /** Rank outstanding material by department (admin) or by material (one HOD). */
  outstandingMode: OutstandingMode;
  /** Off on a single-department board, where the column is one repeated word. */
  showDepartment?: boolean;
  /** Whose name a drill row shows. False on the HOD board — the reader raised
   *  every pass on it, so their own name back at them is noise. */
  showRaisedBy?: boolean;
  onRefresh?: () => void;
  /** Rendered above the sections — the HOD's expired-pass banner. */
  banner?: React.ReactNode;
  /** Rendered at the foot — the HOD's flagged-review queue. */
  footer?: React.ReactNode;
};

export default function GateBoard({
  title, subtitle, rows, items, loading, error, registerTo, outstandingMode,
  showDepartment = true, showRaisedBy = true, onRefresh, banner, footer,
}: Props): React.ReactElement {
  const [period, setPeriod] = useState<DashboardPeriod>('today');
  const [drill, setDrill] = useState<BoardDrill | null>(null);

  // THE FIVE ARRAYS EVERY FIGURE ON THIS PAGE IS DRAWN FROM. Built once, here,
  // so a tile and the list its click opens are the same array by construction.
  const windows: BoardWindows = useMemo(() => {
    const cur = periodBounds(period);
    const prev = previousPeriodBounds(period);
    const within = (iso: string | null, b: { start: number; end: number }): boolean => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= b.start && t < b.end;
    };
    return {
      raised: rows.filter((p) => within(p.created_at, cur)),
      raisedPrev: rows.filter((p) => within(p.created_at, prev)),
      // A RETURN is dated by when the material came back, never by when the pass
      // was raised — scoping it on `created_at` would drop today's return of a
      // pass raised last month, which is most of them.
      returned: rows.filter((p) => within(p.actual_return_date, cur)),
      returnedPrev: rows.filter((p) => within(p.actual_return_date, prev)),
      all: rows,
    };
  }, [rows, period]);

  /** Still-out material, all time — the return watch, the ring and the ranked
   *  bars all read this one array. */
  const outstanding = useMemo(() => rows.filter((p) => IS_OPEN_RETURN[p.return_status]), [rows]);

  // Toggling: clicking the thing already open closes it. Compared by `key`, not by
  // object identity — every render builds fresh drill objects.
  const select = useCallback((next: BoardDrill) => {
    setDrill((cur) => (cur?.key === next.key ? null : next));
  }, []);

  // A `BoardDrill` CARRIES its rows, so one left open across a period change would
  // keep listing passes captured under the old window while every figure around it
  // moved — the one way this board could show a list that disagrees with the tile
  // that opened it.
  const choosePeriod = useCallback((next: DashboardPeriod) => {
    setPeriod(next);
    setDrill(null);
  }, []);

  const activeKey = drill?.key ?? null;
  const resultsRef = useScrollIntoViewOnChange<HTMLDivElement>(activeKey);
  const comparisonLabel = PERIOD_COMPARISON_LABEL[period];

  return (
    <div>
      <BoardHeader
        title={title}
        subtitle={subtitle}
        period={period}
        onPeriodChange={choosePeriod}
        onRefresh={onRefresh}
        refreshing={loading}
      />

      {error && <div className="alert-error mb-6">{error}</div>}
      {banner}

      <div className="flex flex-col gap-4">
        <BoardKpiSection
          title="RGP Overview"
          hint="Returnable material"
          keys={RGP_SECTION}
          windows={windows}
          period={period}
          comparisonLabel={comparisonLabel}
          loading={loading}
          activeKey={activeKey}
          onSelect={select}
        />
        <BoardKpiSection
          title="NRGP Overview"
          hint="Leaving for good"
          keys={NRGP_SECTION}
          windows={windows}
          period={period}
          comparisonLabel={comparisonLabel}
          loading={loading}
          activeKey={activeKey}
          onSelect={select}
        />
      </div>

      {/* The drill panel sits directly under the sections rather than at the foot
          of the page: it is opened from anywhere on the board, and a reader who
          clicked a bar at the bottom should not have to hunt for where the answer
          appeared. `useScrollIntoViewOnChange` brings it into view. */}
      {drill && (
        <div ref={resultsRef} className="mt-6" role="region" aria-label="Selected passes">
          <DrillList def={drillDefOf(drill)} rows={drill.rows} loading={loading} showRaisedBy={showRaisedBy} />
        </div>
      )}

      {/* A 12-column grid rather than equal halves: the trend plots up to 30
          buckets and needs the room; the ring is a fixed 150px plus its legend. */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mt-6">
        <div className="xl:col-span-8 min-w-0">
          <BoardMovementTrend rows={rows} loading={loading} activeKey={activeKey} onSelect={select} />
        </div>
        <div className="xl:col-span-4 min-w-0">
          <BoardStatusBreakdown rows={rows} loading={loading} activeKey={activeKey} onSelect={select} />
        </div>
      </div>

      {/* Return Watch gets 8 of 12 on purpose: it has eight columns, and at half
          the width the table would scroll sideways on every laptop. */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 mt-4">
        <div className="xl:col-span-8 min-w-0">
          <BoardReturnWatch
            rows={rows}
            loading={loading}
            activeKey={activeKey}
            onSelect={select}
            showDepartment={showDepartment}
          />
        </div>
        <div className="xl:col-span-4 min-w-0">
          <BoardActivityTimeline rows={rows} loading={loading} viewAllTo={registerTo} />
        </div>
      </div>

      <div className="mt-4">
        <BoardOutstanding
          rows={outstanding}
          items={items}
          mode={outstandingMode}
          loading={loading}
          activeKey={activeKey}
          onSelect={select}
        />
      </div>

      <div className="mt-4">
        <BoardKpiSection
          title="Quick Summary"
          hint="Both categories together"
          keys={SUMMARY_SECTION}
          windows={windows}
          period={period}
          comparisonLabel={comparisonLabel}
          loading={loading}
          activeKey={activeKey}
          onSelect={select}
        />
      </div>

      {footer}
    </div>
  );
}
