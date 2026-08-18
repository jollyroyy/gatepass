// One figure on the board: a tinted glyph, the words, the number, and what it
// means.
//
// THERE IS NO DELTA LINE. "↑ 8 vs yesterday" was removed from every tile at the
// client's instruction (2026-08-17), and removed rather than hidden: the tile
// takes no `previous` prop and `BoardWindows` no longer carries a previous
// window, so nothing on this board can compute one. Pinned by
// tests/unit/boardKpiTile.test.tsx.
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
import React from 'react';
import { Link } from 'react-router-dom';
import type { BoardKpi } from '../../lib/boardKpis';
import BoardKpiIcon from './BoardKpiIcon';
import { TONE_TEXT } from '../KpiCard';

type Props = {
  kpi: BoardKpi;
  /** Already carries its period word where one is true — see `kpiLabel`. */
  label: string;
  value: number;
  loading: boolean;
  active: boolean;
  onClick: () => void;
  /** Set on the figures that own a page — Overdue and Due Today. A tile with a
   *  destination NAVIGATES and never drills: two ways to open the same list,
   *  one of them narrower than the other, is how they drift apart. */
  to?: string;
};

export default function BoardKpiTile({
  kpi, label, value, loading, active, onClick, to,
}: Props): React.ReactElement {
  const className = `card card-hover p-4 flex flex-col gap-2.5 text-left w-full min-w-0 cursor-pointer${
    active && !to ? ' ring-2 ring-brand-500/60' : ''
  }`;

  const body = (
    <>
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

      {/* A card with nothing to add renders NO line, not an empty one: the
          summary row is deliberately note-less, and a blank span would still
          cost it a line of height and leave the row uneven. */}
      {kpi.note && <span className="text-caption text-navy-500 leading-tight">{kpi.note}</span>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={className}>
      {body}
    </button>
  );
}
