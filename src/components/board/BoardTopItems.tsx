// "Top Items Today" — which materials crossed the gate most often today, as a
// ring.
//
// It replaced the reference board's Gate Activity Timeline in this slot (client,
// 2026-08-17: "just remove today's gate activity timeline and put top items by
// their frequency as a pie chart").
//
// FREQUENCY MEANS TRIPS, NOT UNITS, which is the client's own word and also the
// only ranking that answers an operations question. One delivery of 500 screws is
// one movement; ten separate ladder trips are ten. Ranking by `quantity` would
// put the screws on top every single day and say nothing about what keeps
// occupying the loading bay. A pass carrying three lines of the same material
// still counts once, for the same reason.
//
// IT IS A DRILL, like every other figure on this board: each slice carries the
// passes behind it, so the legend's number and the list its click opens are the
// same array.
import React, { useMemo } from 'react';
import type { GatePassView, GatePassItemView } from '../../types';
import { topMaterials, type Slice } from '../../lib/boardAnalytics';
import type { BoardDrill } from '../../lib/boardDrills';
import DonutChart from '../charts/DonutChart';
import { rankColor } from '../charts/chartPalette';
import BoardCard from './BoardCard';

/** A ring reads as a shape, and past about six slices it reads as a barcode. */
const TOP = 5;

type Props = {
  /** TODAY'S passes only — the caller day-scopes, exactly as it does for the
   *  tiles, so this panel cannot disagree with the day-scoped figures. */
  rows: GatePassView[];
  /** Line rows for those passes. `topMaterials` ignores any item whose parent is
   *  not in `rows`, so a stale fetch can never add a slice the click cannot show. */
  items: GatePassItemView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
};

export default function BoardTopItems({
  rows, items, loading, activeKey, onSelect,
}: Props): React.ReactElement {
  const slices = useMemo(() => topMaterials(items, rows, TOP), [items, rows]);

  // Ranked colours rather than a fixed map: the slices are DATA, not a closed
  // taxonomy — "Hydraulic Pump" has no colour of its own the way "Overdue" does.
  const colors = useMemo(
    () => Object.fromEntries(slices.map((s, i) => [s.key, rankColor(i)])),
    [slices],
  );

  const open = (slice: Slice): void => {
    onSelect({
      key: `topitem-${slice.key}`,
      heading: `${slice.label} — today's passes`,
      empty: 'No pass carried this item today.',
      rows: slice.rows,
    });
  };

  return (
    <BoardCard
      title="Top Items Today"
      subtitle={`Most frequently moved materials — top ${TOP} by number of passes.`}
      loading={loading}
      skeletonHeight="h-72"
    >
      {slices.length === 0 ? (
        <div className="empty-state">No material moved through the gate today.</div>
      ) : (
        <DonutChart
          slices={slices}
          colors={colors}
          centerLabel="Passes Today"
          activeKey={activeKey?.startsWith('topitem-') ? activeKey.slice('topitem-'.length) : null}
          onSelect={open}
        />
      )}
    </BoardCard>
  );
}
