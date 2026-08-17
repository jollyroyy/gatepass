// The board's top bar: what this board is, what day it is, the period it is
// showing, and a way to re-read the database.
//
// THE DATE IS PRINTED IN FULL ("Monday, 17 Aug 2026"), as the client's reference
// board does, and it is not decoration: every figure below is scoped to a window
// that ends today, so a board left open overnight on a wall screen would otherwise
// present yesterday's numbers with nothing on the page to say so.
import React from 'react';
import DashboardPeriodFilter from '../DashboardPeriodFilter';
import type { DashboardPeriod } from '../../lib/dashboardPeriod';

const TODAY_FORMAT = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

type Props = {
  title: string;
  subtitle: string;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export default function BoardHeader({
  title, subtitle, period, onPeriodChange, onRefresh, refreshing,
}: Props): React.ReactElement {
  return (
    <div className="page-header flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-caption text-navy-600 border border-surface-200 rounded-xl px-3 py-2 whitespace-nowrap">
          {TODAY_FORMAT.format(new Date())}
        </span>
        <DashboardPeriodFilter value={period} onChange={onPeriodChange} />
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="btn-secondary px-3 py-2 text-caption whitespace-nowrap disabled:opacity-60"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );
}
