// Premium segmented period selector, shared by the admin and HOD dashboards
// (Today / Weekly / Biweekly / Monthly / Yearly) AND the HOD's My Passes page
// (Today / Last 7 Days / Last 30 Days / Last 6 Months / Weekly / Monthly /
// Yearly — via the `periods` prop, MY_PASSES_PERIODS from myPassesPeriod.ts).
// One control, one styling story, one accessibility story; the consumer picks
// which list of periods it offers.
//
// Follows the `tab-group` segmented-control idiom used by ReportsToolbar.tsx
// and ReportsFilterBar.tsx, but the active segment uses brand gold with
// charcoal text (`bg-brand-600 text-shell-ink`, the same pair `.btn-primary`
// and `.sidebar-link-active` use) rather than the neutral white/navy
// `.tab-active` those Reports controls use — this is the one dashboard-level
// control the user asked to read as "premium", and gold is this app's one
// brand accent. White text on that gold fails AA (~2.4:1); charcoal passes
// (~9.1:1) — never swap that pairing.
import React from 'react';
import { DASHBOARD_PERIODS } from '../lib/dashboardPeriod';

export type PeriodOption<K extends string> = { key: K; label: string };

type Props<K extends string> = {
  value: K;
  onChange: (period: K) => void;
  /** Which periods to offer. Defaults to the dashboards' five. */
  periods?: readonly PeriodOption<K>[];
};

export default function DashboardPeriodFilter<K extends string>({
  value,
  onChange,
  periods = DASHBOARD_PERIODS as unknown as readonly PeriodOption<K>[],
}: Props<K>): React.ReactElement {
  return (
    <div
      role="group"
      aria-label="Dashboard period"
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