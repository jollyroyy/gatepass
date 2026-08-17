// "Today's Gate Activity" — what actually crossed the barrier today, as a ring.
//
// THIS REPLACED THE ACTIVITY TIMELINE (client, 2026-08-17: "instead make it pie
// chart format"). The timeline listed the five most recent movements; the ring
// shows all of today's, in proportion, which is the question a board answers.
// Nothing is lost by dropping the individual lines: a slice opens the passes
// behind it, and the register linked at the foot has every movement of every day.
//
// IT IS A DRILL, WHICH THE TIMELINE WAS NOT. Each slice carries the passes it
// counted (`gateActivitySlices`), so the legend's number and the list its click
// opens are the same array — the board's one invariant, which the timeline was
// exempt from only because a single line already WAS one pass.
//
// TODAY ONLY, and on this board that is no longer a special case: the whole
// board is today. `gateActivityEvents` still dates a movement by `verified_at` /
// `actual_return_date` rather than `created_at`, because a gate log built on
// when the paperwork was typed would show a busy morning on a day nothing moved.
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { gateActivitySlices } from '../../lib/gateActivity';
import { ACTIVITY_COLORS } from '../charts/chartPalette';
import DonutChart from '../charts/DonutChart';
import type { BoardDrill } from '../../lib/boardDrills';

type Props = {
  /** Every pass the reader may see — the panel picks today's movements itself. */
  rows: GatePassView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
  /** Where "View all" goes. `/all-passes` is admin-only, so the route is the
   *  consumer's to name and never this panel's to assume. */
  viewAllTo: string;
};

export default function BoardActivityPie({
  rows, loading, activeKey, onSelect, viewAllTo,
}: Props): React.ReactElement {
  const slices = useMemo(() => gateActivitySlices(rows), [rows]);
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  return (
    <section className="card p-5 flex flex-col min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="card-title border-0 pb-0">Today's Gate Activity</h2>
        <span className="text-caption tabular text-navy-500 shrink-0">{loading ? '—' : total}</span>
      </div>
      <p className="text-caption text-navy-500 mb-4">Cleared and returned at the gate today.</p>

      {loading ? (
        <div className="skeleton h-72 w-full" />
      ) : total === 0 ? (
        <div className="empty-state">Nothing has moved through the gate today.</div>
      ) : (
        // The ring is 150px and its legend runs the full width of whatever
        // contains it, so the whole thing is capped and centred rather than
        // stretched across a full-width card into four very wide legend rows.
        <div className="w-full max-w-sm mx-auto">
          <DonutChart
            slices={slices}
            colors={ACTIVITY_COLORS}
            centerLabel="Movements Today"
            activeKey={activeKey}
            onSelect={(slice) =>
              onSelect({
                key: `activity-${slice.key}`,
                heading: `${slice.label} today`,
                empty: 'Nothing moved through the gate under this heading today.',
                rows: slice.rows,
              })
            }
          />
        </div>
      )}

      {!loading && (
        <Link to={viewAllTo} className="text-caption font-semibold text-accent-600 hover:underline mt-4 self-start">
          View all gate activity →
        </Link>
      )}
    </section>
  );
}
