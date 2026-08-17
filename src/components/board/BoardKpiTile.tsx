// One figure on the board: a tinted glyph, the words, the number, what it means,
// and — where the figure has a previous window to compare against — how it moved.
//
// NOTHING ON THIS TILE IS TRUNCATED, and that is the client's explicit
// instruction ("make sure all the boxes are properly fitted, all the texts are
// properly fitted inside the box"). The defences, in the order they matter:
//
//   * The label WRAPS instead of clipping. A grid row stretches to its tallest
//     item, so a two-line label makes the whole row one line taller and every
//     tile stays aligned — where `truncate` would have hidden half of "Material
//     Currently Outside" behind an ellipsis and a `title` nobody hovers.
//   * `tabular` figures, so a number that ticks never reflows its own width.
//   * `min-w-0` at every level, so a long word can shrink its column rather than
//     forcing the grid — and hence the page — to scroll sideways.
//
// THE DELTA IS AN ABSOLUTE CHANGE, NOT A PERCENTAGE ("↑ 4 vs yesterday"). A
// percentage on a small count is noise a reader cannot act on: 1 → 3 is "+200%",
// which sounds like a crisis and means two more passes. It also has no honest
// form when the previous window was empty, which on a Today board is most days.
import React from 'react';
import type { BoardKpi } from '../../lib/boardKpis';
import BoardKpiIcon from './BoardKpiIcon';
import { TONE_TEXT } from '../KpiCard';

type Props = {
  kpi: BoardKpi;
  /** Already carries its period word where one is true — see `kpiLabel`. */
  label: string;
  value: number;
  /** The same figure in the previous window, or null when the card is a running
   *  state with no previous window to compare against. */
  previous: number | null;
  /** "vs yesterday" — what the comparison is against, in words. */
  comparisonLabel: string;
  loading: boolean;
  active: boolean;
  onClick: () => void;
};

export default function BoardKpiTile({
  kpi, label, value, previous, comparisonLabel, loading, active, onClick,
}: Props): React.ReactElement {
  const delta = previous === null ? null : value - previous;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`card card-hover p-4 flex flex-col gap-2.5 text-left w-full min-w-0 cursor-pointer${
        active ? ' ring-2 ring-brand-500/60' : ''
      }`}
    >
      <span className="flex items-start gap-2.5 min-w-0">
        <BoardKpiIcon kpi={kpi.key} tone={kpi.tone} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] leading-[1.25] text-navy-600 min-w-0 break-words">
          {label}
        </span>
      </span>

      {/* A figure that flashes a spinner on every silent refresh is worse than
          one that shows a placeholder, so `loading` renders a dash. */}
      <span className={`text-[1.75rem] font-extrabold tabular leading-none ${TONE_TEXT[kpi.tone]}`}>
        {loading ? '—' : value}
      </span>

      <span className="text-caption text-navy-500 leading-tight">{kpi.note}</span>

      <span className="text-caption text-navy-500 leading-tight tabular">
        {loading || delta === null ? (
          // A running total has no "yesterday" — the board never took that
          // snapshot. The reference prints a dash here; so do we, rather than
          // fabricating a comparison.
          <span aria-hidden="true">—</span>
        ) : (
          <>
            <span className={`font-bold ${delta === 0 ? '' : delta > 0 ? 'text-matched-700' : 'text-flagged-700'}`}>
              {delta > 0 ? '↑' : delta < 0 ? '↓' : '—'} {Math.abs(delta)}
            </span>{' '}
            {comparisonLabel}
          </>
        )}
      </span>
    </button>
  );
}
