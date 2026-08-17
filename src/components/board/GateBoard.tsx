// TODAY'S GATE PASS SUMMARY — the whole dashboard, shared by the admin and the
// HOD.
//
// One component, two consumers, because the two boards differ only in WHICH ROWS
// they are handed and where their "view all" links point. Duplicating this layout
// per role is how the two dashboards drifted apart before.
//
//   /admin-dashboard  every pass in the org (RLS gives an admin all departments).
//   /dashboard        one HOD's own passes — department scope is RLS's, person
//                     scope is `.eq('raised_by', …)` in useHodBoardData.ts.
//
// THE BOARD IS TODAY-ONLY (client, 2026-08-17). The period selector, the daily
// movement trend, the status ring, the return-watch table and the outstanding
// ranking were all REMOVED — not hidden behind a flag, deleted with their
// components — leaving the three KPI sections, the list a card's click opens,
// and one ring of today's gate activity. Anything older is read in the register
// (`/all-passes` for an admin, `/my-passes` for an HOD), which every panel here
// links to.
//
// NOTHING WAS LOST TO THE OVERDUE READER, and that is why the cut is safe: the
// `current`-scoped cards — Outside, Due Today, Overdue, Pending, Mismatched —
// are running obligations and are NOT day-scoped. An RGP that went overdue last
// month still counts on today's board, and says so on the tile.
//
// THE INVARIANT, UNCHANGED: every clickable figure on this page — tile or ring
// segment — resolves to a `BoardDrill` that CARRIES the rows it counted, and the
// panel below renders exactly that array. There is no `count: 'exact'` query
// anywhere on this board and no predicate re-applied against a second array. Do
// not "optimise" this into aggregate queries: a figure that disagrees with the
// list its own click opens is invisible to the eye and fatal to trust.
import React, { useCallback, useMemo, useState } from 'react';
import type { GatePassView } from '../../types';
import DrillList from '../DrillList';
import { RGP_SECTION, NRGP_SECTION, SUMMARY_SECTION } from '../../lib/boardKpis';
import type { BoardWindows } from '../../lib/boardWindows';
import { drillDefOf, type BoardDrill } from '../../lib/boardDrills';
import { dayStart, DAY_MS } from '../../lib/localDay';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import BoardHeader from './BoardHeader';
import BoardKpiSection from './BoardKpiSection';
import BoardActivityPie from './BoardActivityPie';

type Props = {
  title: string;
  subtitle: string;
  /** Every pass the reader may see. Day-scoping happens here, once. */
  rows: GatePassView[];
  loading: boolean;
  error: string | null;
  /** The register this reader is allowed to open — `/all-passes` is admin-only. */
  registerTo: string;
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
  title, subtitle, rows, loading, error, registerTo,
  showRaisedBy = true, onRefresh, banner, footer,
}: Props): React.ReactElement {
  const [drill, setDrill] = useState<BoardDrill | null>(null);

  // THE THREE ARRAYS EVERY FIGURE ON THIS PAGE IS DRAWN FROM. Built once, here,
  // so a tile and the list its click opens are the same array by construction.
  const windows: BoardWindows = useMemo(() => {
    const start = dayStart(Date.now());
    const end = start + DAY_MS;
    const today = (iso: string | null): boolean => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= start && t < end;
    };
    return {
      raised: rows.filter((p) => today(p.created_at)),
      // A RETURN is dated by when the material came back, never by when the pass
      // was raised — scoping it on `created_at` would drop today's return of a
      // pass raised last month, which is most of them.
      returned: rows.filter((p) => today(p.actual_return_date)),
      all: rows,
    };
  }, [rows]);

  // Toggling: clicking the thing already open closes it. Compared by `key`, not by
  // object identity — every render builds fresh drill objects.
  const select = useCallback((next: BoardDrill) => {
    setDrill((cur) => (cur?.key === next.key ? null : next));
  }, []);

  const activeKey = drill?.key ?? null;
  const resultsRef = useScrollIntoViewOnChange<HTMLDivElement>(activeKey);

  return (
    <div>
      <BoardHeader title={title} subtitle={subtitle} onRefresh={onRefresh} refreshing={loading} />

      {error && <div className="alert-error mb-6">{error}</div>}
      {banner}

      <div className="flex flex-col gap-4">
        <BoardKpiSection
          title="RGP Overview"
          hint="Returnable material"
          keys={RGP_SECTION}
          windows={windows}
          loading={loading}
          activeKey={activeKey}
          onSelect={select}
        />
        <BoardKpiSection
          title="NRGP Overview"
          hint="Leaving for good"
          keys={NRGP_SECTION}
          windows={windows}
          loading={loading}
          activeKey={activeKey}
          onSelect={select}
        />
      </div>

      {/* The drill panel sits directly under the sections rather than at the foot
          of the page: it is opened from anywhere on the board, and a reader who
          clicked the ring at the bottom should not have to hunt for where the
          answer appeared. `useScrollIntoViewOnChange` brings it into view. */}
      {drill && (
        <div ref={resultsRef} className="mt-6" role="region" aria-label="Selected passes">
          <DrillList def={drillDefOf(drill)} rows={drill.rows} loading={loading} showRaisedBy={showRaisedBy} />
        </div>
      )}

      <div className="mt-4">
        <BoardKpiSection
          title="Quick Summary"
          hint="Both categories together"
          keys={SUMMARY_SECTION}
          windows={windows}
          loading={loading}
          activeKey={activeKey}
          onSelect={select}
        />
      </div>

      <div className="mt-4">
        <BoardActivityPie
          rows={rows}
          loading={loading}
          activeKey={activeKey}
          onSelect={select}
          viewAllTo={registerTo}
        />
      </div>

      {footer}
    </div>
  );
}
