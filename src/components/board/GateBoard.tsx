// THE GATE PASS MANAGEMENT BOARD — the whole dashboard, shared by the admin and
// the HOD.
//
// One component, two consumers, because the two boards differ only in WHICH ROWS
// they are handed and where their "view all" links point. Duplicating this layout
// per role is how the two dashboards drifted apart before.
//
//   /admin-dashboard  every pass in the org (RLS gives an admin all departments).
//   /dashboard        one HOD's own passes — department scope is RLS's, person
//                     scope is `.eq('raised_by', …)` in useHodBoardData.ts.
//
// IT IS THE CLIENT'S REFERENCE LAYOUT, BOX FOR BOX (2026-08-17, second pass:
// "I want to see exactly in this format… the exact graph looking and the exact
// layout of those individual boxes should remain the same"), with exactly two
// deliberate departures, both of them the client's own words:
//
//   * NO "vs yesterday" ANYWHERE. Removed rather than hidden — `BoardWindows`
//     carries no previous window, so nothing here can compute a delta.
//   * NO GATE ACTIVITY TIMELINE. Its slot in the third row is "Top Items Today",
//     a ring of the materials that moved most often today.
//
// TWO KINDS OF SCOPE LIVE ON THIS PAGE, and mixing them up is the mistake this
// layout is arranged to prevent:
//
//   TODAY — the "raised" / "cleared" / "returned" tiles. The word "Today" is on
//           the HEADER CHIP, once, and on no tile (client, 2026-08-18); each
//           tile's `note` says what it is.
//   RUNNING — everything about open obligations: outside, due, overdue, the
//           status ring, the return watch and the attention strip. They are NOT
//           day-scoped, because an obligation does not stop being open because
//           the calendar rolled over.
//
// NEITHER BOARD CARRIES A TODAY'S SUMMARY ROW (client, 2026-08-18, HOD first
// and then admin). Five roll-up figures sitting above two rows that break the
// same passes down by category said the same thing twice; the board opens on
// RGP Overview now. Deleted, not flagged off — the keys are out of
// `BoardKpiKey`.
//
// THE ADMIN BOARD HAS NO STRAPLINE. "Real-time overview of all material gate pass
// activity" was removed in the same instruction: a sentence describing the page
// describes nothing the summary row does not already show. `subtitle` is
// therefore optional, and the HOD board still passes one because there it names
// the department the figures belong to, which is a fact and not a description.
//
// THE OUTSTANDING RANKING ("Passes with material still out — top 5") is gone from
// both boards and DELETED, not flagged off: `BoardOutstanding`, `BarList` and
// `departmentSlices` are out of the tree, so it cannot come back by flipping a
// prop. Return Watch breaks the same open obligations down by how late they are.
//
// THE INVARIANT, UNCHANGED THROUGH EVERY REBUILD: every clickable figure on this
// page — tile, ring segment, bar, tab, day on the trend line, attention count —
// resolves to a `BoardDrill` that CARRIES the rows it counted, and the panel
// below renders exactly that array. There is no `count: 'exact'` query anywhere
// on this board and no predicate re-applied against a second array. Do not
// "optimise" this into aggregate queries: a figure that disagrees with the list
// its own click opens is invisible to the eye and fatal to trust.
import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView, GatePassItemView } from '../../types';
import DrillList from '../DrillList';
import { RGP_SECTION, NRGP_SECTION } from '../../lib/boardKpis';
import type { BoardWindows } from '../../lib/boardWindows';
import { drillDefOf, type BoardDrill } from '../../lib/boardDrills';
import { dayStart, DAY_MS } from '../../lib/localDay';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import BoardHeader from './BoardHeader';
import BoardKpiSection from './BoardKpiSection';
import BoardAttention from './BoardAttention';
import BoardMovementTrend from './BoardMovementTrend';
import BoardStatusBreakdown from './BoardStatusBreakdown';
import BoardReturnWatch from './BoardReturnWatch';
import BoardTopItems from './BoardTopItems';

type Props = {
  title: string;
  /** A FACT about whose figures these are, or nothing. The admin board passes
   *  nothing — a sentence describing the page is not a fact. */
  subtitle?: string;
  /** Every pass the reader may see. Day-scoping happens here, once. */
  rows: GatePassView[];
  /** Line rows for those passes — what the Top Items ring is built from. */
  items: GatePassItemView[];
  loading: boolean;
  error: string | null;
  /** The register this reader is allowed to open — `/all-passes` is admin-only. */
  registerTo: string;
  /** Off on a single-department board, where the column is one repeated word. */
  showDepartment?: boolean;
  /** Whose name a drill row shows. False on the HOD board — the reader raised
   *  every pass on it, so their own name back at them is noise. */
  showRaisedBy?: boolean;
  onRefresh?: () => void;
  /** Rendered under the attention strip — the HOD's register link. */
  banner?: React.ReactNode;
  /** Rendered at the foot — the HOD's flagged-review queue. */
  footer?: React.ReactNode;
};

export default function GateBoard({
  title, subtitle, rows, items, loading, error, registerTo,
  showDepartment = true, showRaisedBy = true, onRefresh, banner, footer,
}: Props): React.ReactElement {
  const [drill, setDrill] = useState<BoardDrill | null>(null);

  // THE THREE ARRAYS EVERY TILE ON THIS PAGE IS DRAWN FROM. Built once, here,
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
      <BoardAttention rows={rows} activeKey={activeKey} onSelect={select} />
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

      {/* Return Watch gets 8 of 12 on purpose: it has eight columns, and any
          narrower the table scrolls sideways on every laptop. The ring beside it
          is 150px plus a legend, which is what 4 columns holds. */}
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
          <BoardTopItems
            rows={windows.raised}
            items={items}
            loading={loading}
            activeKey={activeKey}
            onSelect={select}
          />
        </div>
      </div>

      {footer}

      <p className="text-[11px] text-navy-500 mt-6">
        Anything older or wider than these panels is in{' '}
        <Link to={registerTo} className="text-accent-600 hover:underline font-semibold">
          the register
        </Link>
        .
      </p>
    </div>
  );
}
