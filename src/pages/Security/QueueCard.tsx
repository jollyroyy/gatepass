// One pending pass as a queue row. The 2026-08-08 card rule: a queue entry is
// a horizontal row (PassRow) whose click drills straight into /verify/:id —
// everything the current card asked to be checked is one row + a tap away.
// The wait pill survives as the row's trailing chip: how long a truck has
// waited is the gate's most urgent number.
import React from 'react';
import type { GatePassView } from '../../types';
import PassRow from '../../components/PassRow';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Waiting-time pill, overdue-coloured when >2h. */
function waitBadge(createdAt: string): React.ReactElement {
  const ms = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const text = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const overdue = ms > TWO_HOURS_MS;
  return (
    <span
      className={`text-xs font-semibold px-2.5 py-0.5 rounded-full tabular whitespace-nowrap ${
        overdue
          ? 'bg-overdue-100 text-overdue-700 border border-overdue-300'
          : 'bg-surface-100 text-navy-500 border border-surface-300'
      }`}
    >
      {text}
    </span>
  );
}

type Props = {
  pass: GatePassView;
  /** The head of the queue gets a ring. */
  isOldest: boolean;
};

export default function QueueCard({ pass, isOldest }: Props): React.ReactElement {
  return (
    <PassRow
      pass={pass}
      to={`/verify/${pass.id}`}
      isOldest={isOldest}
      badge={waitBadge(pass.created_at)}
    />
  );
}