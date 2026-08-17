// The attention strip above the tile rows: passes that are stopped, and passes
// that are dead.
//
// WHY IT IS A BANNER AND NOT TWO MORE TILES. The tile rows are a settled set the
// client has revised box by box, and neither of these is a measurement of the
// day's traffic. But both facts still have to reach the reader:
//
//   MISMATCHED — security stopped it. It is waiting on ONE person's decision.
//   EXPIRED    — it never reached the gate before its own expiry, so `match_pass`
//                will refuse it forever. The paperwork is null and void; the only
//                way material moves now is a fresh pass.
//
// Both are ALL-TIME, not day-scoped, for the same reason the overdue tiles are: a
// pass stopped yesterday is still stopped this morning, and a day-scoped count
// would read 0 with material standing at the barrier.
//
// Each count is a drill like everything else on this board — it carries the rows
// it counted, so the list its click opens is that array and not a re-query.
import React from 'react';
import type { GatePassView } from '../../types';
import { isExpiredPending } from '../../lib/statusStyles';
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
  const expired = rows.filter(isExpiredPending);

  // Nothing wrong renders nothing. An empty red strip on a quiet day trains the
  // reader to ignore the one that matters.
  if (flagged.length === 0 && expired.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-3 mb-4" role="group" aria-label="Needs attention">
      {flagged.length > 0 && (
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
      )}

      {expired.length > 0 && (
        <button
          type="button"
          aria-pressed={activeKey === 'attention-expired'}
          onClick={() =>
            onSelect({
              key: 'attention-expired',
              heading: 'Expired without reaching the gate — null and void',
              empty: 'Nothing has expired.',
              rows: expired,
            })
          }
          className={`flex-1 min-w-[240px] text-left rounded-r-lg border-l-4 border-overdue-500 bg-overdue-500/10 px-4 py-3 transition-colors hover:bg-overdue-500/20${
            activeKey === 'attention-expired' ? ' ring-2 ring-overdue-500/50' : ''
          }`}
        >
          <span className="block text-sm font-semibold text-overdue-700">
            {expired.length} {plural(expired.length, 'pass', 'passes')} expired and void
          </span>
          <span className="block text-caption text-navy-500">
            Never reached the gate — raise again or void permanently.
          </span>
        </button>
      )}
    </div>
  );
}
