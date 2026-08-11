// Shared grid-column template for the Material Items section of RaisePass.tsx
// — ONE source of truth for MaterialItemsCard's header row and every
// MaterialItemRow, so the columns can never drift out of alignment with each
// other. This is the fix for "the date and item fields are not properly
// aligned — currently haphazard": before this, the Return Date column only
// existed on RGP rows and every field used an ad hoc `flex-*`/`min-w-*`
// width, so no two rows (or the header) agreed on where a column started.
//
// Column order: Item Name, Description, Purpose, Qty, Unit, Value, then
// Return Date ONLY when the pass type requires one, then a fixed-width
// remove column. `.item-grid` (src/index.css) reads this off the
// `--item-grid-cols` custom property and collapses to a single column below
// the `md` breakpoint.
import type React from 'react';

const WITH_RETURN_DATE =
  'minmax(140px,1.6fr) minmax(180px,2fr) minmax(140px,1.6fr) 72px 88px 110px 140px 40px';
const WITHOUT_RETURN_DATE =
  'minmax(140px,1.6fr) minmax(180px,2fr) minmax(140px,1.6fr) 72px 88px 110px 40px';

export function itemGridColumns(showReturnDate: boolean): string {
  return showReturnDate ? WITH_RETURN_DATE : WITHOUT_RETURN_DATE;
}

/** The gap between columns, in px — must match `.item-grid`'s column-gap
 *  (`gap: 0.75rem 1rem`) in index.css. */
const COLUMN_GAP_PX = 16;

/** The narrowest the grid can be drawn without a column shrinking below its
 *  own minimum: every track's minimum, plus the gaps between them.
 *
 *  This exists because of the 2026-08-11 report that "the background frame is
 *  a bit shorter" than the fields. The row's grey frame is a plain block, so
 *  it spans only the CARD's width — but the grid inside it cannot draw
 *  narrower than this sum, so the fields overflowed the frame and sat on the
 *  page background. The frame is now given this as a `min-width` and the whole
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

/** Inline style carrying the grid template as a CSS custom property — pass
 *  the SAME `showReturnDate` value used for the header and for every row. */
export function itemGridStyle(showReturnDate: boolean): React.CSSProperties {
  return { '--item-grid-cols': itemGridColumns(showReturnDate) } as React.CSSProperties;
}
