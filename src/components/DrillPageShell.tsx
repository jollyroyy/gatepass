// THE PAGE A KPI FIGURE OPENS — the frame, shared by all three boards.
//
// Client, 2026-08-23: "whenever we are drilling down on any of the KPI cards in
// HOD or in the guards view, don't show the table on the same page. Show it on a
// different page, like you are showing the overdue details … do the same thing
// for all the KPI cards." Every board's figures used to reveal their list under
// themselves; only Overdue navigated. This is what the others navigate to.
//
// IT COUNTS NOTHING AND FETCHES NOTHING. The page that renders it rebuilds the
// board's own row from the board's own read and hands over the array the figure
// counted, so the number pressed and the list that opens still cannot disagree
// — the drill page is the same derivation, on a second screen.
//
// EVERY CLASS IS A `.gb-*`. These pages are the same scoped, fixed-light island
// the boards are drawn in, so no colour is introduced and `themeAudit` stays
// absolute over `src/components/**`.
import React from 'react';
import { Link } from 'react-router-dom';

type Props = {
  /** Where the back link goes — the board this figure was pressed on. */
  backTo: string;
  backLabel: string;
  title: string;
  /** The scope in words, under the title: what this list is and is not. */
  subtitle?: string;
  /** Drawn beside the title once the rows are in. Omitted while loading, so a
   *  reader is never shown a count that is about to change. */
  count?: number;
  error?: string | null;
  children: React.ReactNode;
};

export default function DrillPageShell({
  backTo, backLabel, title, subtitle, count, error, children,
}: Props): React.ReactElement {
  return (
    <div className="gb-board gb-main">
      <div className="gb-head-row">
        <div className="min-w-0">
          <Link to={backTo} className="gb-back">
            <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.5L7.5 12l7.5-7.5" />
            </svg>
            {backLabel}
          </Link>
          <h1 className="gb-hello">
            {title}
            {count !== undefined && (
              <span className="gb-head-count">
                {count} {count === 1 ? 'pass' : 'passes'}
              </span>
            )}
          </h1>
          {subtitle && <p className="gb-sub">{subtitle}</p>}
        </div>
      </div>

      {error && <div className="gb-alert">{error}</div>}

      {children}
    </div>
  );
}
