// The pass's history as a row of small moments: "RAISED 09:47  CLEARED OUT
// 10:02  RETURNED 3 Aug".
//
// Extracted 2026-08-11 when the card badge collapsed to a single latest-state
// pill (src/lib/passStage.ts) and the timeline became the ONLY place the
// outward match and the return are legible. At that point three files —
// PassRow, PassRowBody and PassRowCompact — each carried their own byte-
// identical copy of this markup, and the timeline had just gone from
// decoration to the load-bearing record of what happened. Three copies of
// that is three chances for one surface to quietly stop rendering a moment.
//
// `passTimeline` decides WHICH moments exist; this decides how they look.
import React from 'react';
import { isToday } from 'date-fns';
import { passTimeline } from '../lib/passTimeline';
import type { TimelineMoment } from '../lib/passTimeline';
import { formatDateOnly, formatTime } from '../lib/formatDate';

/** Time for something that happened today, date otherwise — a guard reading a
 *  card at the barrier cares about the hour; an HOD reading last month's
 *  register cares about the day. */
function MomentPill({ label, at }: TimelineMoment): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-navy-500 whitespace-nowrap">
      <span className="w-1 h-1 rounded-full bg-navy-300" />
      <span className="uppercase tracking-wider text-navy-500 text-[10px] font-semibold">{label}</span>
      {isToday(new Date(at)) ? formatTime(at) : formatDateOnly(at)}
    </span>
  );
}

type Props = {
  pass: Parameters<typeof passTimeline>[0];
  /** Extra content pinned after the moments (e.g. a "View full pass" link). */
  children?: React.ReactNode;
  className?: string;
};

export default function PassTimelineStrip({
  pass,
  children,
  className = 'flex flex-wrap items-center gap-3',
}: Props): React.ReactElement {
  return (
    <span className={className}>
      {passTimeline(pass).map((m) => (
        <MomentPill key={m.label} label={m.label} at={m.at} />
      ))}
      {children}
    </span>
  );
}
