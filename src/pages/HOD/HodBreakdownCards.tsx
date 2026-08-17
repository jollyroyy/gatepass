// The HOD board's bottom row: Top Materials and Returnable Status.
//
// TWO PANELS, NOT THE ADMIN BOARD'S THREE. "Department Activity" is gone, and
// its absence is the point rather than an omission: since migration `032` a
// person belongs to at most one department, and RLS shows an HOD only their
// own (`gate_passes_select`: `department_id in (select my_department_ids())`).
// A ranking of departments on this board is therefore one bar, at 100%, with
// the reader's own department name on it — a chart that can only ever tell them
// something they already knew. The client asked for the admin board's charts
// "kept relevant to that HOD", and this is the one that is not.
//
// Both panels are drillable on the same `onSelect` as everything else on the
// board, and both carry the rows they counted. Same invariant, same reason.
import React from 'react';
import type { GatePassView, GatePassItemView } from '../../types';
import type { BoardDrill } from '../../lib/boardDrills';
import { returnableSlices, topMaterials, type Slice } from '../../lib/boardAnalytics';
import BarList from '../../components/charts/BarList';
import DonutChart from '../../components/charts/DonutChart';
import { RETURNABLE_COLORS } from '../../components/charts/chartPalette';
import BoardCard from '../../components/board/BoardCard';

const TOP_MATERIALS = 6;

type Props = {
  rows: GatePassView[];
  items: GatePassItemView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
};

export default function HodBreakdownCards({ rows, items, loading, activeKey, onSelect }: Props): React.ReactElement {
  const materials = topMaterials(items, rows, TOP_MATERIALS);
  const returnable = returnableSlices(rows);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
      <BoardCard
        title="Top Materials"
        subtitle="By movement — how many of your passes carried it, not how many units"
        loading={loading}
      >
        <BarList
          slices={materials}
          // The denominator is EVERY pass in scope, not the six bars shown —
          // percentages over a truncated top-6 would sum to 100% of a subset
          // and overstate each material by however much the tail holds.
          total={rows.length}
          valueMode="count"
          emptyMessage="No material lines in this period."
          activeKey={keyWithin(activeKey, 'material')}
          onSelect={(s) => onSelect(drillOf('material', s, `${s.label} — passes carrying it`))}
        />
      </BoardCard>

      <BoardCard
        title="Returnable Status"
        subtitle="Your RGP passes only — an NRGP never enters a return cycle"
        loading={loading}
        skeletonHeight="h-72"
      >
        <DonutChart
          slices={returnable}
          colors={RETURNABLE_COLORS}
          centerLabel="Returnable"
          activeKey={keyWithin(activeKey, 'returnable')}
          onSelect={(s) => onSelect(drillOf('returnable', s, returnableHeading(s)))}
        />
      </BoardCard>
    </div>
  );
}

function drillOf(prefix: string, slice: Slice, heading: string): BoardDrill {
  return {
    key: `${prefix}-${slice.key}`,
    heading,
    empty: 'No passes in this bucket.',
    rows: slice.rows,
  };
}

function keyWithin(activeKey: string | null, prefix: string): string | null {
  return activeKey?.startsWith(`${prefix}-`) ? activeKey.slice(prefix.length + 1) : null;
}

/** The return ring's three buckets need their own words: "Awaiting Return"
 *  here means still out AND not yet late, because overdue is a separate arc —
 *  see `returnableSlices`. A heading that just echoed the label would leave a
 *  reader wondering why the overdue passes are missing from it. */
function returnableHeading(slice: Slice): string {
  if (slice.key === 'returned') return 'Returned in full';
  if (slice.key === 'overdue') return 'Still out and past their return date';
  return 'Still out, not yet due';
}
