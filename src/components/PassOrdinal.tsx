// The position of a card in a stacked list — "1", "2", "3"…
//
// Client, 2026-08-18: "in the stacked list there is no numbering so it is very
// hard to find how many exactly." A drill heading already says "12 passes";
// what it could not say is WHICH of the twelve the reader is looking at, or
// how far down the stack they have scrolled.
//
// 1-based, assigned by the LIST, never derived from the pass — the same pass
// is #3 in one drill and #1 in another, and the number describes the position
// on this screen, not the pass itself. That is why it is `aria-hidden`: it is
// a wayfinding mark, and a screen reader already announces list position.
import React from 'react';

type Props = { index: number };

export default function PassOrdinal({ index }: Props): React.ReactElement {
  return (
    <span
      data-testid="pass-ordinal"
      aria-hidden="true"
      className="inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0
                 bg-surface-200 text-navy-600 text-[11px] font-bold tabular-nums"
    >
      {index}
    </span>
  );
}
