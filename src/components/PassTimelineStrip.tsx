// The pass's history as small moments: "RAISED 09:47", "CLEARED OUT 10:02",
// "RETURNED 3 Aug". Two orientations — a one-line strip for a collapsed row,
// and a VERTICAL rail for an opened card, which is what a timeline reads as
// (client, 2026-08-18: "show it in a vertical way ... whenever we are drilling
// down on the stacked cards across all the views").
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

/** The same moment as a rung of a vertical timeline: a dot on a rail, the
 *  label, and the time hard right. Used inside an opened card, where the
 *  moments are the pass's history and reading them DOWN is what makes the
 *  order obvious (client, 2026-08-18). The rail is drawn on the row rather
 *  than behind the list so the last dot ends it — a line running past the
 *  final moment reads as a step that has not happened yet. */
function MomentRow({ label, at, last }: TimelineMoment & { last: boolean }): React.ReactElement {
  return (
    <span className="flex items-start gap-2 min-w-0">
      <span className="flex flex-col items-center self-stretch shrink-0 pt-1">
        <span className="w-1.5 h-1.5 rounded-full bg-navy-400" />
        {!last && <span className="w-px flex-1 min-h-[0.75rem] bg-surface-300" />}
      </span>
      <span className="flex-1 flex items-baseline justify-between gap-2 min-w-0 pb-1.5">
        <span className="uppercase tracking-wider text-navy-500 text-[10px] font-semibold truncate">
          {label}
        </span>
        <span className="text-[11px] font-medium text-navy-600 tabular-nums whitespace-nowrap">
          {isToday(new Date(at)) ? formatTime(at) : formatDateOnly(at)}
        </span>
      </span>
    </span>
  );
}

type Props = {
  pass: Parameters<typeof passTimeline>[0];
  /** Extra content pinned after the moments (e.g. a "View full pass" link). */
  children?: React.ReactNode;
  className?: string;
  /** 'vertical' is the opened card's timeline — one moment per line, on a
   *  rail. 'horizontal' (the default) is the one-line strip a collapsed row
   *  carries, where there is no vertical room to spend. */
  orientation?: 'horizontal' | 'vertical';
};

export default function PassTimelineStrip({
  pass,
  children,
  className,
  orientation = 'horizontal',
}: Props): React.ReactElement {
  const moments = passTimeline(pass);
  if (orientation === 'vertical') {
    return (
      <span
        data-testid="pass-timeline"
        className={className ?? 'flex flex-col min-w-0 w-full sm:max-w-xs'}
      >
        {moments.map((m, i) => (
          <MomentRow key={m.label} label={m.label} at={m.at} last={i === moments.length - 1} />
        ))}
        {children}
      </span>
    );
  }
  return (
    <span data-testid="pass-timeline" className={className ?? 'flex flex-wrap items-center gap-3'}>
      {moments.map((m) => (
        <MomentPill key={m.label} label={m.label} at={m.at} />
      ))}
      {children}
    </span>
  );
}
