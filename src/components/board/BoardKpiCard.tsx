// One headline KPI on the admin board: icon, label, number, a "vs previous"
// delta, and a note that says what to DO about it.
//
// This is a richer card than the shared `KpiCard`, and it is deliberately NOT a
// widening of that one — `KpiCard` is on the guard and HOD boards too, and
// growing it to carry an icon slot and a delta would push extra optional props
// onto three screens that want none of them.
//
// THERE IS NO CHART ON THIS CARD (client, 2026-08-17: "don't put the small
// graphs inside the KPI numbers"). The 7-day sparkline that used to sit beside
// the figure was deleted rather than restyled: it normalised against its own
// peak, so two of them on one row were not comparable to each other, and it
// took width from the only thing on the card anybody reads. Trend over time
// lives once, on the Passes Trend line, which has an axis and a window the
// reader chose. Do not put it back.
//
// OVERFLOW IS THE THING THIS FILE IS MOST CAREFUL ABOUT — the client asked
// specifically that no number or label spill. Two defences, both of which have
// to hold at 5-across on a laptop:
//   * the label and the note both `truncate`, with the full text on `title`;
//   * `tabular` figures, so a ticking number never reflows its own width.
import React from 'react';
import type { BoardKpi } from '../../lib/boardDrills';
import BoardKpiIcon from './BoardKpiIcon';
import { TONE_TEXT } from '../KpiCard';

type Props = {
  kpi: BoardKpi;
  value: number;
  /** Percentage change against the previous window, or null when there is
   *  nothing to compare against (see adminAnalytics.deltaPercent). */
  delta: number | null;
  /** What the delta compares against, in words — "vs yesterday". */
  deltaLabel: string;
  loading: boolean;
  active: boolean;
  onClick: () => void;
};

export default function BoardKpiCard({
  kpi, value, delta, deltaLabel, loading, active, onClick,
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
        <BoardKpiIcon kpi={kpi.key} tone={kpi.tone} />
        <span className="kpi-label truncate min-w-0" title={kpi.label}>
          {kpi.label}
        </span>
      </div>

      {/* A KPI that flashes a spinner on every silent refresh is worse than one
          that shows a placeholder, so `loading` renders a dash. */}
      <div className="min-w-0">
        <span className={`text-kpi tabular leading-none ${TONE_TEXT[kpi.tone]}`}>
          {loading ? '—' : value}
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
