// A ranked horizontal bar list — "Department Activity" and "Top Materials".
//
// The bar is sized against the LEADER, not against the total. Against the total,
// a healthy spread across twelve departments draws twelve stubs and the card
// says nothing; against the leader, the shape of the ranking is legible at a
// glance. The percentage beside it is still of the TOTAL, because that is the
// number a reader would quote — so both facts are on the row and neither is
// inferred from the other's geometry.
import React from 'react';
import type { Slice } from '../../lib/boardAnalytics';
import { percentOf } from '../../lib/chartGeometry';
import { rankColor } from './chartPalette';

type Props = {
  slices: Slice[];
  /** Denominator for the percentage. Defaults to the sum of the slices shown —
   *  pass the unsliced total when the list is truncated to a top N, or the
   *  percentages will add to 100% of a subset and quietly overstate everything. */
  total?: number;
  /** Right-hand figure: the share, or the raw count. Departments read better as
   *  a share; a material count is a count. */
  valueMode?: 'percent' | 'count';
  emptyMessage: string;
  activeKey?: string | null;
  onSelect?: (slice: Slice) => void;
};

export default function BarList({
  slices,
  total,
  valueMode = 'percent',
  emptyMessage,
  activeKey,
  onSelect,
}: Props): React.ReactElement {
  if (slices.length === 0) {
    return <div className="empty-state">{emptyMessage}</div>;
  }

  const denominator = total ?? slices.reduce((s, x) => s + x.value, 0);
  const leader = Math.max(...slices.map((s) => s.value), 1);

  return (
    <ul className="flex flex-col gap-1">
      {slices.map((slice, i) => {
        const color = rankColor(i);
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3 min-w-0">
              <span className="text-body text-navy-800 truncate">{slice.label}</span>
              <span className="text-caption tabular text-navy-500 shrink-0">
                {slice.value} {slice.value === 1 ? 'pass' : 'passes'}
              </span>
            </span>
            <span className="flex items-center gap-3 mt-1.5">
              <span className="flex-1 h-2 rounded-full bg-surface-200 overflow-hidden">
                <span
                  className="block h-full rounded-full transition-all duration-300"
                  style={{ width: `${Math.max((slice.value / leader) * 100, 2)}%`, background: color }}
                />
              </span>
              <span className="text-caption font-semibold tabular text-navy-700 shrink-0 w-12 text-right">
                {valueMode === 'percent' ? `${Math.round(percentOf(slice.value, denominator))}%` : slice.value}
              </span>
            </span>
          </>
        );

        if (!onSelect) {
          return (
            <li key={slice.key} className="flex flex-col px-2 py-2 rounded-xl">
              {body}
            </li>
          );
        }
        return (
          <li key={slice.key}>
            <button
              type="button"
              onClick={() => onSelect(slice)}
              aria-pressed={activeKey === slice.key}
              // Same reason as the donut legend: the visible text is a label, a
              // count and a percentage in separate spans, which concatenate
              // without gaps into one unreadable token.
              aria-label={`${slice.label}: ${slice.value} ${slice.value === 1 ? 'pass' : 'passes'}`}
              className={`w-full flex flex-col px-2 py-2 rounded-xl text-left transition-colors duration-150 hover:bg-surface-100${
                activeKey === slice.key ? ' bg-surface-100 ring-1 ring-brand-500/40' : ''
              }`}
            >
              {body}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
