// The shell both guard-board lists share: a titled card that shows the first
// few rows and expands in place. Drawn to the client's mock-up (2026-08-19) —
// a coloured glyph and title, "View All" top right, and the same control
// repeated centred under the last row.
//
// "View all" EXPANDS RATHER THAN NAVIGATES. Both of these lists live nowhere
// else at this scope — the pending queue is this board's own, and the return
// backlog is graded line by line on `/overdue` — so sending the reader away to
// see rows six and seven would either need a page that does not exist or a
// second query that could disagree with the number on the card above it.
import React from 'react';
import { PREVIEW_ROWS } from '../../lib/guardBoard';
import { GuardGlyphIcon, type GuardGlyph, type GuardTone } from './GuardIcon';

type Props = {
  title: string;
  glyph: GuardGlyph;
  tone: GuardTone;
  /** The full list's length — what "View All (N)" names, not the shown count. */
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
  const ink = tone === 'orange' ? 'gb-ink-orange' : 'gb-ink-blue';

  return (
    <section className="gb-card gb-panel">
      <div className="gb-panel-head">
        <GuardGlyphIcon glyph={glyph} tone={tone} />
        <h2 className={`gb-panel-title ${ink}`}>{title}</h2>
        {hasMore && (
          <button type="button" onClick={onToggle} className="gb-link">
            {expanded ? 'Show Less' : 'View All'}
          </button>
        )}
      </div>

      {loading ? (
        <div className="gb-empty">
          <div className="gb-skeleton" />
        </div>
      ) : total === 0 ? (
        <div className="gb-empty">{empty}</div>
      ) : (
        <>
          <div className="gb-scroll">{children}</div>
          {hasMore && (
            <div className="gb-panel-foot">
              <button type="button" onClick={onToggle} className="gb-link">
                {expanded ? 'Show Less' : `View All (${total})`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
