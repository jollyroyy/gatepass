// "Gate Pass Overview" — the donut, read two ways.
//
// The mode select is where the client's reference board puts a period dropdown.
// It is a MODE here instead, because a second period control on one card
// contradicting the board's own period filter is the fastest way to make two
// panels disagree in front of a client. What the two modes answer:
//
//   Category — what the passes WERE (RGP Out / RGP In / NRGP Out).
//   Status   — where they GOT TO (pending / expired / cleared / mismatched…).
//
// Status mode is the one that carries `Mismatched`, which has no headline KPI
// of its own. That is not a gap: a mismatch is the guard's finding and the HOD's
// decision, and an admin's board should show it in proportion to the rest of the
// traffic rather than as a fifth alarm across the top.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';
import type { AdminDrill } from '../../lib/adminDrills';
import { categorySlices, statusSlices, type Slice } from '../../lib/adminAnalytics';
import DonutChart from '../../components/charts/DonutChart';
import { CATEGORY_COLORS, PASS_STATUS_COLORS } from '../../components/charts/chartPalette';
import AdminCard, { AdminCardSelect } from './AdminCard';

type Mode = 'category' | 'status';

type Props = {
  rows: GatePassView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: AdminDrill) => void;
};

export default function AdminOverviewCard({ rows, loading, activeKey, onSelect }: Props): React.ReactElement {
  const [mode, setMode] = useState<Mode>('category');
  const slices = mode === 'category' ? categorySlices(rows) : statusSlices(rows);

  return (
    <AdminCard
      title="Gate Pass Overview"
      loading={loading}
      skeletonHeight="h-44"
      control={
        <AdminCardSelect
          label="Gate Pass Overview breakdown"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'category', label: 'By category' },
            { value: 'status', label: 'By status' },
          ]}
        />
      }
    >
      <DonutChart
        slices={slices}
        colors={mode === 'category' ? CATEGORY_COLORS : PASS_STATUS_COLORS}
        centerLabel="Total Passes"
        hideEmpty={mode === 'status'}
        activeKey={sliceKeyOf(activeKey, mode)}
        onSelect={(slice) => onSelect(drillOf(slice, mode))}
      />
    </AdminCard>
  );
}

/** Drill keys are namespaced by mode so "Cleared at Gate" (status) and any
 *  future category of the same name can never collide, and so switching modes
 *  does not leave the wrong slice looking selected. */
function drillOf(slice: Slice, mode: Mode): AdminDrill {
  return {
    key: `overview-${mode}-${slice.key}`,
    heading: mode === 'category' ? `${slice.label} passes` : `${slice.label} — ${slice.value === 1 ? 'this pass' : 'these passes'}`,
    empty: 'No passes in this bucket.',
    rows: slice.rows,
  };
}

function sliceKeyOf(activeKey: string | null, mode: Mode): string | null {
  const prefix = `overview-${mode}-`;
  return activeKey?.startsWith(prefix) ? activeKey.slice(prefix.length) : null;
}
