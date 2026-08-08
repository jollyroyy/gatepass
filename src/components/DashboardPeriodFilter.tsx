// Period selector for the admin and HOD dashboards — Today / Weekly /
// Biweekly / Monthly / Yearly. Shared by both pages so the control, its
// styling, and its accessibility story live in exactly one place.
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
import { DASHBOARD_PERIODS, type DashboardPeriod } from '../lib/dashboardPeriod';

type Props = {
  value: DashboardPeriod;
  onChange: (period: DashboardPeriod) => void;
};

export default function DashboardPeriodFilter({ value, onChange }: Props): React.ReactElement {
  return (
    <div
      role="group"
      aria-label="Dashboard period"
      className="inline-flex flex-wrap gap-1 bg-surface-100 dark:bg-white/5 rounded-xl p-1"
    >
      {DASHBOARD_PERIODS.map(({ key, label }) => {
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
                : 'text-navy-400 hover:text-navy-600 rounded-lg px-3.5 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
