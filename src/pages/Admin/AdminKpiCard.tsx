// One headline KPI on the admin board: icon, label, number, a "vs previous"
// delta, a note that says what to DO about it, and a 7-day sparkline.
//
// This is a richer card than the shared `KpiCard`, and it is deliberately NOT a
// widening of that one — `KpiCard` is on the guard and HOD boards too, and
// growing it to carry an icon slot, a delta and a chart would push five extra
// optional props onto three screens that want none of them.
//
// OVERFLOW IS THE THING THIS FILE IS MOST CAREFUL ABOUT — the client asked
// specifically that no number or label spill. Three defences, all of which have
// to hold at 5-across on a laptop:
//   * the number and the sparkline share a row that can shrink, and the
//     sparkline is the half that gives way (`min-w-0` + `hidden xl:block`);
//   * the label and the note both `truncate`, with the full text on `title`;
//   * `tabular` figures, so a ticking number never reflows its own width.
import React from 'react';
import type { AdminKpi } from '../../lib/adminDrills';
import AdminKpiIcon from './AdminKpiIcon';
import Sparkline from '../../components/charts/Sparkline';
import { TONE_TEXT } from '../../components/KpiCard';
import { TONE_SERIES_COLOR } from '../../components/charts/chartPalette';

type Props = {
  kpi: AdminKpi;
  value: number;
  /** Percentage change against the previous window, or null when there is
   *  nothing to compare against (see adminAnalytics.deltaPercent). */
  delta: number | null;
  /** What the delta compares against, in words — "vs yesterday". */
  deltaLabel: string;
  trend: number[];
  loading: boolean;
  active: boolean;
  onClick: () => void;
};

export default function AdminKpiCard({
  kpi, value, delta, deltaLabel, trend, loading, active, onClick,
}: Props): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`card card-hover p-5 flex flex-col gap-3 text-left w-full cursor-pointer min-w-0${
        active ? ' ring-2 ring-brand-500/60' : ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <AdminKpiIcon kpi={kpi.key} tone={kpi.tone} />
        <span className="kpi-label truncate min-w-0" title={kpi.label}>
          {kpi.label}
        </span>
      </div>

      <div className="flex items-end justify-between gap-2 min-w-0">
        {/* A KPI that flashes a spinner on every silent refresh is worse than
            one that shows a placeholder, so `loading` renders a dash. */}
        <span className={`text-kpi tabular leading-none shrink-0 ${TONE_TEXT[kpi.tone]}`}>
          {loading ? '—' : value}
        </span>
        {/* The sparkline gives way, never the number: it is shape, not a figure.
            `shrink-0` above plus `min-w-0` here means a four-digit count at
            5-across squeezes the chart rather than overflowing the card, and
            below `xl` (where the cards are narrowest per column) it is hidden
            outright. */}
        <span className="hidden xl:block flex-1 min-w-0 max-w-[96px]">
          <Sparkline values={trend} color={TONE_SERIES_COLOR[kpi.tone]} />
        </span>
      </div>

      <div className="flex items-center gap-2 min-w-0">
        {delta !== null && !loading && (
          <span
            className={`text-caption font-semibold tabular shrink-0 ${
              delta >= 0 ? 'text-matched-700' : 'text-flagged-700'
            }`}
          >
            {delta >= 0 ? '+' : ''}
            {delta}%
          </span>
        )}
        <span className="text-caption text-navy-500 truncate min-w-0" title={delta !== null ? deltaLabel : kpi.note}>
          {delta !== null ? deltaLabel : kpi.note}
        </span>
      </div>
    </button>
  );
}
