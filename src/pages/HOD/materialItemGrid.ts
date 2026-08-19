// Shared grid-column template for the "Item-wise Details" table on RaisePass.tsx
// — ONE source of truth for MaterialItemsCard's header row and every
// MaterialItemRow, so the columns can never drift out of alignment with each
// other. This is the fix for "the date and item fields are not properly
// aligned — currently haphazard": before this, columns varied per row on ad
// hoc `flex-*`/`min-w-*` widths, so no two rows (or the header) agreed on
// where a column started.
//
// Column order is the client's mock-up (2026-08-19), left to right:
//
//   #  ·  Item Description  ·  Quantity  ·  Make / Model / Size  ·
//   Serial / Asset Tag  ·  Invoice / Reference No.  ·  Remarks / Description  ·
//   Expected Return Date (RGP only)  ·  Action
//
// THE UOM COLUMN IS GONE (client: remove it) and so are Purpose and Value —
// purpose is asked once for the whole pass, and the mock has no value column.
//
// THERE IS ONE VARIANT, AND ONLY ONE: an RGP carries an "Expected Return Date"
// column between Remarks and Action (client, 2026-08-19: "we would expect a
// date of return against each item in the RGP form"). An NRGP never comes back,
// so drawing an empty date column on one would be a question with no answer.
// The flag is threaded from the pass type in RaisePass, so the header and every
// row read the same boolean and cannot disagree about how many columns exist.
//
// `.item-grid` (src/index.css) reads this off the `--item-grid-cols` custom
// property and collapses to a single column below the `md` breakpoint.
import type React from 'react';

const BASE =
  '36px minmax(160px,1.8fr) minmax(90px,0.9fr) minmax(150px,1.5fr) minmax(140px,1.4fr) minmax(150px,1.5fr) minmax(150px,1.5fr)';
const RETURN_DATE = 'minmax(150px,1.3fr)';

export function itemGridColumns(showReturnDate: boolean): string {
  return [BASE, ...(showReturnDate ? [RETURN_DATE] : []), '56px'].join(' ');
}

/** The gap between columns, in px — must match `.item-grid`'s column-gap
 *  (`gap: 0.75rem 1rem`) in index.css. */
const COLUMN_GAP_PX = 16;

/** The narrowest the grid can be drawn without a column shrinking below its
 *  own minimum: every track's minimum, plus the gaps between them.
 *
 *  This exists because of the 2026-08-11 report that "the background frame is
 *  a bit shorter" than the fields. The row's frame is a plain block, so it
 *  spans only the CARD's width — but the grid inside it cannot draw narrower
 *  than this sum, so the fields overflowed the frame and sat on the page
 *  background. The frame is now given this as a `min-width` and the whole
 *  section scrolls horizontally as one, so the frame is never narrower than
 *  what it contains and the columns still share one line. */
export function itemGridMinWidth(showReturnDate: boolean): string {
  const tracks = itemGridColumns(showReturnDate).split(' ');
  const total = tracks.reduce((sum, track) => {
    // `minmax(140px,1.6fr)` → 140; a bare `72px` → 72.
    const min = track.startsWith('minmax(') ? track.slice(7).split(',')[0] : track;
    return sum + parseFloat(min);
  }, 0);
  return `${total + COLUMN_GAP_PX * (tracks.length - 1)}px`;
}

/** Inline style carrying the grid template as a CSS custom property — shared
 *  by the header and every row. */
export function itemGridStyle(showReturnDate: boolean): React.CSSProperties {
  return { '--item-grid-cols': itemGridColumns(showReturnDate) } as React.CSSProperties;
}
