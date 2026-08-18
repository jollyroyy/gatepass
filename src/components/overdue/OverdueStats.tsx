// The four figures at the top of Overdue Items, in the client's reference
// layout (2026-08-18): a tinted glyph, the words, the number.
//
// EVERY NUMBER HERE IS `rows.length` OF AN ARRAY THE PAGE ALSO HOLDS — the
// board's invariant, applied to a line-level page. Total and Critical count the
// rows in the table below; Due Today counts the lines that are NOT in it yet,
// which is the one figure on the row that is not a slice of the table, and its
// label says so.
//
// AVERAGE DELAY IS IN DAYS, not "1d 7h". `expected_return_date` is a `date` —
// no time of day exists to make an hours figure out of.
import React from 'react';
import { TONE_TEXT, type Tone } from '../KpiCard';
import type { OverdueStats as Stats } from '../../lib/overdueItems';

type Props = { stats: Stats; loading: boolean };

const ICON = { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 1.8 } as const;

const CLOCK = (
  <svg {...ICON}><circle cx="12" cy="12" r="8.25" /><path strokeLinecap="round" d="M12 7.5V12l3 1.75" /></svg>
);
const ALERT = (
  <svg {...ICON}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M11.14 4.6a1 1 0 011.72 0l7.1 12.4a1 1 0 01-.86 1.5H4.9a1 1 0 01-.86-1.5l7.1-12.4z" />
    <path strokeLinecap="round" d="M12 9.75v3.5M12 16.25h.01" />
  </svg>
);
const CALENDAR = (
  <svg {...ICON}>
    <rect x="3.75" y="5.25" width="16.5" height="15" rx="2" />
    <path strokeLinecap="round" d="M8.25 3.75v3M15.75 3.75v3M3.75 9.75h16.5" />
  </svg>
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
  const tiles: { label: string; value: string | number; tone: Tone; icon: React.ReactNode }[] = [
    { label: 'Total overdue', value: stats.total, tone: 'flagged', icon: CLOCK },
    { label: 'Critical overdue', value: stats.critical, tone: 'flagged', icon: ALERT },
    { label: 'Due back today', value: stats.dueToday, tone: 'overdue', icon: CLOCK },
    {
      label: 'Average delay',
      value: stats.total === 0 ? '—' : `${stats.averageDelay}d`,
      tone: 'neutral',
      icon: CALENDAR,
    },
  ];

  return (
    <div role="group" aria-label="Overdue figures" className="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
      {tiles.map((t) => (
        <div key={t.label} className="card p-4 flex items-center gap-3 min-w-0">
          <span className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${TINT[t.tone]}`} aria-hidden="true">
            {t.icon}
          </span>
          <span className="flex flex-col min-w-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.05em] leading-[1.25] text-navy-600 break-words">
              {t.label}
            </span>
            {/* A figure that flashes a spinner on every silent refresh is worse
                than one that shows a placeholder, so `loading` renders a dash. */}
            <span className={`text-[1.75rem] font-extrabold tabular leading-none mt-1 ${TONE_TEXT[t.tone]}`}>
              {loading ? '—' : t.value}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
