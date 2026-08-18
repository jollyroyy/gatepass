// The one figure at the top of Overdue Items: how many material lines are late.
//
// IT IS `rows.length` OF THE ARRAY THE TABLE BELOW RENDERS — the board's
// invariant, applied to a line-level page. Critical, Due back today and Average
// delay were removed at the client's request (2026-08-18): the table already
// grades each row Critical or Overdue, and a figure nobody acts on is clutter
// on a screen read standing at a gate.
import React from 'react';
import { TONE_TEXT, type Tone } from '../KpiCard';
import type { OverdueStats as Stats } from '../../lib/overdueItems';

type Props = { stats: Stats; loading: boolean };

const ICON = { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.8 } as const;

const CLOCK = (
  <svg {...ICON}><circle cx="12" cy="12" r="8.25" /><path strokeLinecap="round" d="M12 7.5V12l3 1.75" /></svg>
);

/** The tinted disc behind each glyph. Status tints only — this row is entirely
 *  about lateness, so nothing on it takes the brand gold. */
const TINT: Record<Tone, string> = {
  neutral: 'bg-surface-200 text-navy-600',
  pending: 'bg-pending-50 text-pending-700',
  matched: 'bg-matched-50 text-matched-700',
  flagged: 'bg-flagged-50 text-flagged-700',
  overdue: 'bg-overdue-50 text-overdue-700',
  brand: 'bg-brand-600/10 text-brand-800 dark:text-brand-300',
  accent: 'bg-accent-50 text-accent-700',
};

export default function OverdueStats({ stats, loading }: Props): React.ReactElement {
  return (
    <div role="group" aria-label="Overdue figures" className="mb-5">
      <div className="card p-4 flex items-center gap-3 min-w-0 sm:max-w-xs">
        <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${TINT.flagged}`} aria-hidden="true">
          {CLOCK}
        </span>
        <span className="flex flex-col min-w-0">
          <span className="text-[11px] font-semibold uppercase tracking-[0.05em] leading-[1.25] text-navy-600 break-words">
            Total overdue
          </span>
          {/* A figure that flashes a spinner on every silent refresh is worse
              than one that shows a placeholder, so `loading` renders a dash. */}
          <span className={`text-[1.75rem] font-extrabold tabular leading-none mt-1 ${TONE_TEXT.flagged}`}>
            {loading ? '—' : stats.total}
          </span>
        </span>
      </div>
    </div>
  );
}
