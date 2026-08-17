// "Today's Gate Activity" — a log of what actually crossed the barrier today,
// newest first.
//
// DELIBERATELY NOT A DRILL. Every other panel on this board answers "show me the
// N passes behind this number"; this one answers "what just happened", and a click
// on a single line should open that pass, not a filtered list of one. Each row is
// therefore a link straight to the pass, and the footer links to the register.
//
// TODAY ONLY, AND THAT IS NOT A TRUNCATION. The panel answers what is happening at
// the gate right now; any other day is read in the register, which the footer links
// to. It ignores the period filter for that reason and says so.
import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { gateActivityEvents, ACTIVITY_BADGE, type GateActivityKind } from '../../lib/gateActivity';
import { formatTime } from '../../lib/formatDate';

/** The client's "keep only the top items". */
const SHOWN = 5;

/** Tinted badge, dark ink — never a solid saturated fill, which is reserved for
 *  the gate's own decision buttons. A `Record`, so a new event kind without a
 *  style is a type error rather than an unstyled word. */
const BADGE: Record<GateActivityKind, string> = {
  out: 'bg-accent-50 text-accent-600',
  in: 'bg-accent-50 text-accent-600',
  returned: 'bg-matched-50 text-matched-700',
  cleared: 'bg-matched-50 text-matched-700',
};

const DOT: Record<GateActivityKind, string> = {
  out: 'bg-accent-500',
  in: 'bg-accent-500',
  returned: 'bg-matched-500',
  cleared: 'bg-matched-500',
};

type Props = {
  /** Every pass the reader may see. The panel picks today's movements itself —
   *  the period filter has no say over a log of the current shift. */
  rows: GatePassView[];
  loading: boolean;
  /** Where "View all" goes. `/all-passes` is admin-only, so the route is the
   *  consumer's to name and never this panel's to assume. */
  viewAllTo: string;
};

export default function BoardActivityTimeline({ rows, loading, viewAllTo }: Props): React.ReactElement {
  const events = useMemo(() => gateActivityEvents(rows), [rows]);
  const shown = events.slice(0, SHOWN);

  return (
    <section className="card p-5 flex flex-col h-full min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="card-title border-0 pb-0">Today's Gate Activity</h2>
        <span className="text-caption tabular text-navy-500 shrink-0">{loading ? '—' : events.length}</span>
      </div>
      <p className="text-caption text-navy-500 mb-3">Cleared and returned at the gate today.</p>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-12 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">Nothing has moved through the gate today.</div>
      ) : (
        <ul className="flex flex-col -mx-2">
          {shown.map((e) => (
            <li key={e.key}>
              <Link
                to={`/pass/${e.passId}`}
                className="flex items-start gap-3 px-2 py-2.5 rounded-xl hover:bg-surface-100 transition-colors duration-150 min-w-0"
              >
                <span className="text-caption tabular text-navy-500 shrink-0 w-[4.5rem]">{formatTime(e.at)}</span>
                <span className={`h-2 w-2 rounded-full shrink-0 mt-1.5 ${DOT[e.kind]}`} aria-hidden="true" />
                <span className="flex flex-col min-w-0 flex-1">
                  <span className="text-body font-semibold text-navy-900">{e.title}</span>
                  <span className="text-caption text-navy-500 truncate" title={`${e.passNumber} · ${e.detail}`}>
                    {e.passNumber} · {e.detail}
                  </span>
                </span>
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md shrink-0 ${BADGE[e.kind]}`}
                >
                  {ACTIVITY_BADGE[e.kind]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && (
        <Link to={viewAllTo} className="text-caption font-semibold text-accent-600 hover:underline mt-3 self-start">
          View all gate activity →
        </Link>
      )}
    </section>
  );
}
