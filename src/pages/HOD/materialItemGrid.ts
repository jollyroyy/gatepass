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

/** Inline style carrying the grid template as a CSS custom property — pass
 *  the SAME `showReturnDate` value used for the header and for every row. */
export function itemGridStyle(showReturnDate: boolean): React.CSSProperties {
  return { '--item-grid-cols': itemGridColumns(showReturnDate) } as React.CSSProperties;
}
