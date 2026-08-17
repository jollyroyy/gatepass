// "RGP Status Breakdown (Currently Outside)" — the ring that says how much of the
// material still off site is late, due today, due this week, or comfortably
// scheduled.
//
// IT IS ALL-TIME, NOT PERIOD-SCOPED, and that is the same exception the overdue
// figures make: an open obligation does not stop being open because the calendar
// rolled past the window it started in. An RGP raised three weeks ago whose
// ladders never came back is more urgent today, not less. The subtitle says so.
//
// The four buckets come from `src/lib/returnWatch.ts` — the SAME function the
// Return Watch table below reads, so the ring and the tabs can never disagree
// about which bucket a pass is in.
import React, { useMemo } from 'react';
import type { GatePassView } from '../../types';
import { returnWatchBuckets } from '../../lib/returnWatch';
import type { Slice } from '../../lib/boardAnalytics';
import type { BoardDrill } from '../../lib/boardDrills';
import DonutChart from '../charts/DonutChart';
import { RETURN_WATCH_COLORS } from '../charts/chartPalette';
import BoardCard from './BoardCard';

type Props = {
  /** Every pass the reader may see, unscoped by period. */
  rows: GatePassView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
};

export default function BoardStatusBreakdown({ rows, loading, activeKey, onSelect }: Props): React.ReactElement {
  const slices = useMemo(() => returnWatchBuckets(rows), [rows]);

  const open = (slice: Slice): void => {
    onSelect({
      key: `watch-${slice.key}`,
      heading: `${slice.label} — still out`,
      empty: 'Nothing in this bucket.',
      rows: slice.rows,
    });
  };

  return (
    <BoardCard
      title="RGP Status Breakdown"
      subtitle="Currently outside — all time, whatever the period filter says."
      loading={loading}
      skeletonHeight="h-72"
    >
      <DonutChart
        slices={slices}
        colors={RETURN_WATCH_COLORS}
        centerLabel="Total Outside"
        activeKey={activeKey?.startsWith('watch-') ? activeKey.slice('watch-'.length) : null}
        onSelect={open}
      />
    </BoardCard>
  );
}
