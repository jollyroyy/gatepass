// "Daily Movement Trend" — the last N days of material actually crossing the
// gate, in three lines.
//
// TWO SCOPES DELIBERATELY DIFFER FROM THE REST OF THE BOARD, and the card says
// both out loud rather than leaving them to look like bugs:
//
//   * IT IGNORES THE BOARD'S DAY SCOPE and carries its own window. The tiles are
//     about today, and a trend over one day is a dot.
//   * IT PLOTS GATE EVENTS, NOT RAISED PASSES — `verified_at` and
//     `actual_return_date`, never `created_at`. A movement chart drawn on the
//     paperwork date shows traffic on a day the gate was shut.
import React, { useMemo, useState } from 'react';
import type { GatePassView } from '../../types';
import { movementBuckets, MOVEMENT_SERIES, type MovementBucket } from '../../lib/boardAnalytics';
import type { BoardDrill } from '../../lib/boardDrills';
import TrendChart, { bucketKey, type TrendSeries } from '../charts/TrendChart';
import { MOVEMENT_COLORS } from '../charts/chartPalette';
import BoardCard, { BoardCardSelect } from './BoardCard';

type Window = '7' | '14' | '30';

const WINDOWS: { value: Window; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];

/** RGP Return is dashed: it is the only series a reader compares AGAINST another
 *  (out vs back), and two solid lines of similar height are hard to follow where
 *  they cross. */
const SERIES: readonly TrendSeries[] = MOVEMENT_SERIES.map((s) => ({
  key: s.key,
  label: s.label,
  color: MOVEMENT_COLORS[s.key],
  dashed: s.key === 'rgpReturn',
}));

type Props = {
  /** UNSCOPED by period on purpose — see the note above. */
  rows: GatePassView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
};

export default function BoardMovementTrend({ rows, loading, activeKey, onSelect }: Props): React.ReactElement {
  const [window, setWindow] = useState<Window>('7');
  const days = Number(window);
  const buckets = useMemo(() => movementBuckets(rows, days), [rows, days]);

  const open = (bucket: MovementBucket): void => {
    onSelect({
      key: bucketKey(bucket),
      heading: `Movements on ${bucket.label}`,
      empty: 'Nothing moved through the gate that day.',
      rows: bucket.rows,
    });
  };

  return (
    <BoardCard
      title="Daily Movement Trend"
      subtitle={`Cleared out and returned at the gate — last ${days} days, not just today.`}
      loading={loading}
      skeletonHeight="h-56"
      control={
        <BoardCardSelect label="Trend window" value={window} options={WINDOWS} onChange={setWindow} />
      }
    >
      <TrendChart buckets={buckets} series={SERIES} activeKey={activeKey} onSelect={open} />
    </BoardCard>
  );
}
