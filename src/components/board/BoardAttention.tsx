// The attention strip above the tile rows: passes that are stopped.
//
// WHY IT IS A BANNER AND NOT A TILE. The tile rows are a settled set the client
// has revised box by box, and a mismatch is not a measurement of the day's
// traffic. But the fact still has to reach the reader: security stopped it, and
// it is waiting on ONE person's decision.
//
// It is ALL-TIME, not day-scoped, for the same reason the overdue tiles are: a
// pass stopped yesterday is still stopped this morning, and a day-scoped count
// would read 0 with material standing at the barrier.
//
// EXPIRED IS NOT HERE. It was a second, orange half of this strip until
// 2026-08-18, when the client took expired passes off both boards: an expired
// pass is dead paperwork, `match_pass` refuses it forever, and no figure on a
// board is acted on by looking at it. It is still tracked — the raising HOD gets
// the bell notification that opens `/expired/:id` to void or re-raise it, and
// Reports has its own Expired filter over the whole register.
//
// The count is a drill like everything else on this board — it carries the rows
// it counted, so the list its click opens is that array and not a re-query.
import React from 'react';
import type { GatePassView } from '../../types';
import type { BoardDrill } from '../../lib/boardDrills';

type Props = {
  /** Every pass the reader may see, unscoped by day. */
  rows: GatePassView[];
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
};

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

export default function BoardAttention({ rows, activeKey, onSelect }: Props): React.ReactElement | null {
  const flagged = rows.filter((p) => p.status === 'flagged');

  // Nothing wrong renders nothing. An empty red strip on a quiet day trains the
  // reader to ignore the one that matters.
  if (flagged.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-4" role="group" aria-label="Needs attention">
      <button
        type="button"
        aria-pressed={activeKey === 'attention-flagged'}
        onClick={() =>
          onSelect({
            key: 'attention-flagged',
            heading: 'Mismatched at the gate',
            empty: 'Nothing is stopped at the gate.',
            rows: flagged,
          })
        }
        className={`flex-1 min-w-[240px] text-left rounded-r-lg border-l-4 border-flagged-500 bg-flagged-500/10 px-4 py-3 transition-colors hover:bg-flagged-500/20${
          activeKey === 'attention-flagged' ? ' ring-2 ring-flagged-500/50' : ''
        }`}
      >
        <span className="block text-sm font-semibold text-flagged-700">
          {flagged.length} {plural(flagged.length, 'pass', 'passes')} mismatched at the gate
        </span>
        <span className="block text-caption text-navy-500">
          Stopped by security — the raising HOD decides.
        </span>
      </button>
    </div>
  );
}
