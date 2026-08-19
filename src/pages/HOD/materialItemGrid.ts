// Shared grid-column template for the Material Items section of RaisePass.tsx
// — ONE source of truth for MaterialItemsCard's header row and every
// MaterialItemRow, so the columns can never drift out of alignment with each
// other. This is the fix for "the date and item fields are not properly
// aligned — currently haphazard": before this, columns varied per row on ad
// hoc `flex-*`/`min-w-*` widths, so no two rows (or the header) agreed on
// where a column started.
//
// Column order: Item Name, Description, Serial / ID, Purpose, Qty, Unit,
// Value, then a fixed-width remove column. THERE IS NO VARIANT ANY MORE
// (client, 2026-08-19: the return date moved to the pass level, off this
// grid entirely) — one template for RGP and NRGP alike, so a stale
// `showReturnDate` branch cannot silently reappear. `.item-grid`
// (src/index.css) reads this off the `--item-grid-cols` custom property and
// collapses to a single column below the `md` breakpoint.
import type React from 'react';

const COLUMNS =
  'minmax(140px,1.6fr) minmax(180px,2fr) minmax(120px,1.2fr) minmax(140px,1.6fr) 72px 88px 110px 40px';

export function itemGridColumns(): string {
  return COLUMNS;
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
export function itemGridMinWidth(): string {
  const tracks = itemGridColumns().split(' ');
  const total = tracks.reduce((sum, track) => {
    // `minmax(140px,1.6fr)` → 140; a bare `72px` → 72.
    const min = track.startsWith('minmax(') ? track.slice(7).split(',')[0] : track;
    return sum + parseFloat(min);
  }, 0);
  return `${total + COLUMN_GAP_PX * (tracks.length - 1)}px`;
}

/** Inline style carrying the grid template as a CSS custom property — shared
 *  by the header and every row. */
export function itemGridStyle(): React.CSSProperties {
  return { '--item-grid-cols': itemGridColumns() } as React.CSSProperties;
}
