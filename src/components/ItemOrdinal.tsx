// A numbered badge marking a material line's position in a pass ("Item 1",
// "Item 2"…) — client feedback 2026-08-10: a multi-item pass never
// distinguished its lines from each other, only the item's own name did.
//
// Suppressed entirely on a single-item pass: a big "Item 1" badge on the only
// line on the card is noise, not information — the item's own name already
// identifies it uniquely, and there is nothing to distinguish it FROM.
import React from 'react';

type Props = {
  /** 1-based position in the list. */
  index: number;
  /** Total item lines on the pass — the badge only earns its place above 1. */
  total: number;
};

export default function ItemOrdinal({ index, total }: Props): React.ReactElement | null {
  if (total <= 1) return null;
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0
                 bg-brand-100 text-brand-800 text-xs font-bold tabular-nums"
      aria-label={`Item ${index}`}
    >
      {index}
    </span>
  );
}
