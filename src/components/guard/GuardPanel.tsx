// The shell both guard-board lists share: a titled card that shows the first
// few rows and expands in place.
//
// "View all" EXPANDS RATHER THAN NAVIGATES. Both of these lists live nowhere
// else at this scope — the pending queue is this board's own, and the return
// backlog is graded line by line on `/overdue` — so sending the reader away to
// see rows six and seven would either need a page that does not exist or a
// second query that could disagree with the number on the card above it.
import React from 'react';
import type { Tone } from '../KpiCard';
import { PREVIEW_ROWS } from '../../lib/guardBoard';
import GuardIcon, { type GuardGlyph } from './GuardIcon';

type Props = {
  title: string;
  glyph: GuardGlyph;
  tone: Tone;
  /** The full list's length — what "View all (N)" names, not the shown count. */
  total: number;
  expanded: boolean;
  onToggle: () => void;
  loading: boolean;
  /** Shown instead of the table when there is nothing to act on. */
  empty: string;
  children: React.ReactNode;
};

export default function GuardPanel({
  title, glyph, tone, total, expanded, onToggle, loading, empty, children,
}: Props): React.ReactElement {
  const hasMore = total > PREVIEW_ROWS;

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-200">
        <GuardIcon glyph={glyph} tone={tone} />
        <h2 className="board-section-title min-w-0 flex-1">{title}</h2>
        {hasMore && (
          <button
            type="button"
            onClick={onToggle}
            className="text-xs font-semibold text-accent-600 hover:underline shrink-0"
          >
            {expanded ? 'Show less' : 'View all'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex flex-col gap-2 p-5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : total === 0 ? (
        <div className="empty-state">
          <p>{empty}</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">{children}</div>
          {hasMore && (
            <div className="px-5 py-3 border-t border-surface-200 text-center">
              <button
                type="button"
                onClick={onToggle}
                className="text-xs font-semibold text-accent-600 hover:underline"
              >
                {expanded ? 'Show less' : `View all (${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
