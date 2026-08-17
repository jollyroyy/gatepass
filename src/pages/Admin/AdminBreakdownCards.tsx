// The bottom row: Top Materials, Returnable Status, Department Activity.
//
// Grouped in one file because they share one decision — all three are ranked or
// proportional views of the SAME scoped array, and all three drill through the
// same `onSelect`. Splitting them into three near-identical wrappers would put
// the interesting part (which rows, under which heading) three files away from
// each other.
//
// WHAT REPLACED "GATE WISE ACTIVITY" from the client's reference board, and
// why: this system has no concept of a gate. `gatepass.verifications` records a
// free-text `gate_name` the guard types at verification time, so it exists only
// AFTER a pass is verified, is null on everything still pending, and is spelled
// however the guard spelled it. Ranking on that would produce a chart of typos
// that silently omits the whole pending queue. Department is the real, enforced,
// always-present dimension — `department_id` is NOT NULL on every pass and is
// what RLS itself partitions on — so the panel ranks departments instead.
import React from 'react';
import type { GatePassView, GatePassItemView } from '../../types';
import type { AdminDrill } from '../../lib/adminDrills';
import { departmentSlices, returnableSlices, topMaterials, type Slice } from '../../lib/adminAnalytics';
import BarList from '../../components/charts/BarList';
import DonutChart from '../../components/charts/DonutChart';
import { RETURNABLE_COLORS } from '../../components/charts/chartPalette';
import AdminCard from './AdminCard';

const TOP_MATERIALS = 6;

type Props = {
  rows: GatePassView[];
  items: GatePassItemView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: AdminDrill) => void;
};

export default function AdminBreakdownCards({ rows, items, loading, activeKey, onSelect }: Props): React.ReactElement {
  const materials = topMaterials(items, rows, TOP_MATERIALS);
  const returnable = returnableSlices(rows);
  const departments = departmentSlices(rows);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
      <AdminCard
        title="Top Materials"
        subtitle="By movement — how many passes carried it, not how many units"
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
      </AdminCard>

      <AdminCard
        title="Returnable Status"
        subtitle="RGP passes only — an NRGP never enters a return cycle"
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
      </AdminCard>

      <AdminCard title="Department Activity" subtitle="Passes raised, busiest first" loading={loading}>
        <BarList
          slices={departments}
          total={rows.length}
          emptyMessage="No department raised a pass in this period."
          activeKey={keyWithin(activeKey, 'dept')}
          onSelect={(s) => onSelect(drillOf('dept', s, `${s.label} — passes raised`))}
        />
      </AdminCard>
    </div>
  );
}

function drillOf(prefix: string, slice: Slice, heading: string): AdminDrill {
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
