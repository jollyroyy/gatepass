// The mock-up's table footer: "Showing 1 to 10 of 121 entries" on the left,
// the numbered pages in the middle, "Rows per page" on the right.
//
// The arithmetic is `pageOf` in src/lib/scheduledReturns.ts — the same function
// Overdue Items and Scheduled Returns page with, so "of 121" means the same
// thing on every table in the app. This file is only the buttons, and it is a
// second SKIN of TablePager rather than a second implementation: the house
// pager is gold-on-stone and would be the only house-themed control on a
// screen the client asked for in their own palette.
import React from 'react';
import type { ReturnsPage } from '../../lib/scheduledReturns';
import { ROWS_PER_PAGE } from '../../lib/pendingOutFilters';

/** First, last, and the current page with a neighbour either side. `null` is a
 *  gap, drawn as "…" — never a button, so it cannot be clicked to nowhere. */
export function pageNumbers(current: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const keep = new Set([1, pages, current, current - 1, current + 1]);
  const out: (number | null)[] = [];
  for (let n = 1; n <= pages; n += 1) {
    if (keep.has(n)) {
      out.push(n);
    } else if (out[out.length - 1] !== null) {
      out.push(null);
    }
  }
  return out;
}

type Props = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: ReturnsPage<any>;
  size: number;
  onPage: (page: number) => void;
  onSize: (size: number) => void;
};

export default function GuardPager({ page, size, onPage, onSize }: Props): React.ReactElement {
  return (
    <div className="gb-pager">
      <span>
        Showing {page.from} to {page.to} of {page.total} entries
      </span>

      {page.pages > 1 && (
        <div className="gb-pages">
          <button
            type="button"
            className="gb-page-btn"
            aria-label="Previous page"
            disabled={page.page === 1}
            onClick={() => onPage(page.page - 1)}
          >
            ‹
          </button>
          {pageNumbers(page.page, page.pages).map((n, i) =>
            n === null ? (
              // eslint-disable-next-line react/no-array-index-key
              <span key={`gap-${i}`} className="gb-gap" aria-hidden="true">
                …
              </span>
            ) : (
              <button
                key={n}
                type="button"
                className="gb-page-btn"
                aria-current={n === page.page ? 'page' : undefined}
                onClick={() => onPage(n)}
              >
                {n}
              </button>
            )
          )}
          <button
            type="button"
            className="gb-page-btn"
            aria-label="Next page"
            disabled={page.page === page.pages}
            onClick={() => onPage(page.page + 1)}
          >
            ›
          </button>
        </div>
      )}

      <span className="gb-rows-per-page">
        Rows per page
        <select
          className="gb-select"
          aria-label="Rows per page"
          value={size}
          onChange={(e) => onSize(Number(e.target.value))}
        >
          {ROWS_PER_PAGE.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
