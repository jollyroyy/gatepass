// Premium segmented period selector.
//
// It was `DashboardPeriodFilter`, and both dashboards were its reason for
// existing. They are today-only now (client, 2026-08-17) and carry no selector
// at all, so its ONE remaining consumer is the HOD's My Passes page (Today /
// Last 7 Days / Last 30 Days / Last 6 Months / Weekly / Monthly / Yearly, from
// MY_PASSES_PERIODS in myPassesPeriod.ts). It was renamed rather than left
// pointing at a screen that no longer exists — and there is no default list any
// more, because the dashboards' five went with them: the consumer names its own
// periods or there are none to render.
//
// Follows the `tab-group` segmented-control idiom used by ReportsToolbar.tsx
// and ReportsFilterBar.tsx, but the active segment uses brand gold with
// charcoal text (`bg-brand-600 text-shell-ink`, the same pair `.btn-primary`
// and `.sidebar-link-active` use) rather than the neutral white/navy
// `.tab-active` those Reports controls use — this is the one page-level control
// the user asked to read as "premium", and gold is this app's one brand accent.
// White text on that gold fails AA (~2.4:1); charcoal passes (~9.1:1) — never
// swap that pairing.
import React from 'react';

export type PeriodOption<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  value: K;
  onChange: (period: K) => void;
  /** Which periods to offer. Required — see the note above. */
  periods: readonly PeriodOption<K>[];
  /** The group's accessible name. */
  label?: string;
};

export default function PeriodFilter<K extends string>({
  value,
  onChange,
  periods,
  label: groupLabel = 'Period',
}: Props<K>): React.ReactElement {
  return (
    <div
      role="group"
      aria-label={groupLabel}
      className="inline-flex flex-wrap gap-1 bg-surface-100 dark:bg-white/5 rounded-xl p-1"
    >
      {periods.map(({ key, label }) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(key)}
            className={
              active
                ? 'bg-brand-600 text-shell-ink shadow-soft rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
                : 'text-navy-500 hover:text-navy-600 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
