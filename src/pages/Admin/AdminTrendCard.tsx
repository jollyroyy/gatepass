// "Passes Trend" — RGP and NRGP raised per day.
//
// THIS IS THE ONE PANEL WITH ITS OWN WINDOW, and it takes UNSCOPED rows on
// purpose. The board's default period is Today, and a trend line over one day
// is a single point — not a trend, a dot. So the chart carries its own 7 / 14 /
// 30-day selector, exactly as the client's reference board does, and the card
// says which window is showing so it cannot be mistaken for the board's period.
//
// The trade-off is stated rather than hidden: changing the board's period does
// NOT change this card. That is the honest behaviour — a "last 14 days" line
// re-scoped to Today would have thirteen empty buckets and one spike, which
// looks like a data loss rather than a filter.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';
import type { AdminDrill } from '../../lib/adminDrills';
import { trendBuckets, type TrendBucket } from '../../lib/adminAnalytics';
import TrendChart, { bucketKey } from '../../components/charts/TrendChart';
import AdminCard, { AdminCardSelect } from './AdminCard';

type Window = '7' | '14' | '30';

const WINDOW_LABEL: Record<Window, string> = {
  '7': 'Last 7 days',
  '14': 'Last 14 days',
  '30': 'Last 30 days',
};

type Props = {
  rows: GatePassView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: AdminDrill) => void;
};

export default function AdminTrendCard({ rows, loading, activeKey, onSelect }: Props): React.ReactElement {
  const [window, setWindow] = useState<Window>('7');
  const buckets = trendBuckets(rows, Number(window));

  return (
    <AdminCard
      title="Passes Trend"
      subtitle={`${WINDOW_LABEL[window]} · independent of the board's period filter`}
      loading={loading}
      skeletonHeight="h-56"
      control={
        <AdminCardSelect
          label="Passes Trend window"
          value={window}
          onChange={setWindow}
          options={(Object.keys(WINDOW_LABEL) as Window[]).map((w) => ({ value: w, label: WINDOW_LABEL[w] }))}
        />
      }
    >
      <TrendChart buckets={buckets} activeKey={activeKey} onSelect={(b) => onSelect(drillOf(b))} />
    </AdminCard>
  );
}

function drillOf(bucket: TrendBucket): AdminDrill {
  return {
    key: bucketKey(bucket),
    heading: `Raised on ${bucket.label}`,
    empty: `No passes were raised on ${bucket.label}.`,
    rows: bucket.rows,
  };
}
