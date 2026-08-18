// A vertical bar chart — columns standing on a baseline, one per slice.
//
// Client, 2026-08-18, twice: departments ranked by passes raised (admin board)
// and departments ranked by overdue lines (Overdue tab). Both are "which of
// these is biggest", which a column answers at a glance and a donut does not
// once there are more than about five categories.
//
// Presentation only. It is handed `Slice[]` — the board's own aggregate type,
// which CARRIES the rows it counted — and hands a whole slice back on click, so
// a bar's height and the list its click opens are the same array.
//
// NOT DRAWN IN THE BRAND GOLD: gold is the frame (sidebar, primary button,
// wordmark), so a bar in it reads as chrome. Colours come from chartPalette,
// the one module allowed literal hex.
import React from 'react';
import type { Slice } from '../../lib/boardAnalytics';
import { rankColor } from '../charts/chartPalette';

type Props = {
  slices: Slice[];
  /** Plural noun for the tooltip: "4 passes", "3 overdue items". */
  valueLabel: string;
  empty?: string;
  activeKey?: string | null;
  onSelect?: (slice: Slice) => void;
};

/** The plot's height in px. Fixed, so two of these panels side by side have the
 *  same baseline — a bar chart that resizes with its data is unreadable
 *  between two visits. */
const PLOT_H = 176;

export default function ColumnChart({
  slices, valueLabel, empty = 'Nothing to plot yet.', activeKey, onSelect,
}: Props): React.ReactElement {
  if (slices.length === 0) return <div className="empty-state">{empty}</div>;
  const max = Math.max(...slices.map((s) => s.value));

  return (
    // Scrolls sideways rather than crushing the columns: past six departments a
    // fixed-width chart turns every label into an ellipsis.
    <div className="overflow-x-auto">
      <div className="flex items-end gap-3 min-w-fit" style={{ height: PLOT_H }}>
        {slices.map((s, i) => {
          const pct = max === 0 ? 0 : Math.round((s.value / max) * 100);
          const active = activeKey === s.key;
          const column = (
            <>
              <span className="text-caption font-semibold text-navy-800 tabular-nums">{s.value}</span>
              <span className="flex-1 flex items-end w-full">
                <span
                  data-testid="column-bar"
                  className="w-full rounded-t-md transition-[height] duration-300"
                  style={{ height: `${pct}%`, backgroundColor: rankColor(i), opacity: active ? 1 : 0.85 }}
                />
              </span>
            </>
          );
          const label = (
            <span className="text-[11px] font-medium text-navy-600 text-center leading-tight break-words">
              {s.label}
            </span>
          );
          const shell = 'flex flex-col items-center gap-1 w-16 shrink-0 h-full';
          return onSelect ? (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelect(s)}
              className={`${shell} ${active ? 'opacity-100' : 'hover:opacity-90'}`}
              title={`${s.label} — ${s.value} ${valueLabel}`}
            >
              {column}
              {label}
            </button>
          ) : (
            <span key={s.key} className={shell} title={`${s.label} — ${s.value} ${valueLabel}`}>
              {column}
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
