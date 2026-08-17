// Period selector shared by the admin and HOD dashboards. Both pages used to
// be unconditionally today-only (see git history on hodKpis.ts / AdminDashboard.tsx);
// this is the single source of truth for the five periods a dashboard reader can
// pick, and for turning one into real `[start, end)` Date bounds.
//
// Deliberately a *rolling* window ending at the start of tomorrow (local midnight),
// not a calendar-aligned week/month/year — a dashboard reader wants "the last N
// days including today", not "since the 1st of this month". Real Date arithmetic
// throughout; never compare formatted date strings (see reportsDateRange.ts, which
// this mirrors for the Reports page's own, separate, calendar-day-based presets).
export type DashboardPeriod = 'today' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export const DASHBOARD_PERIODS: { key: DashboardPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Biweekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];

/** How many calendar days back from (and including) today each period spans. */
const PERIOD_DAYS: Record<DashboardPeriod, number> = {
  today: 1,
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  yearly: 365,
};

/** `[start, end)` bounds in local time, as epoch millis: `start` is local
 *  midnight `PERIOD_DAYS[period] - 1` days ago, `end` is local midnight
 *  tomorrow. `today` is therefore exactly `todayBounds()` in hodKpis.ts, which
 *  now delegates here instead of keeping a second implementation. */
export function periodBounds(period: DashboardPeriod): { start: number; end: number } {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = endOfToday.getTime() + 24 * 60 * 60 * 1000;
  const days = PERIOD_DAYS[period];
  const start = endOfToday.getTime() - (days - 1) * 24 * 60 * 60 * 1000;
  return { start, end };
}

/** The window of the SAME LENGTH immediately before `periodBounds(period)` —
 *  what a KPI card's "vs previous" delta is measured against.
 *
 *  It ends exactly where the current window starts, so the two are adjacent and
 *  never overlap: a pass counted in the comparison can never also be counted in
 *  the figure being compared. For `today` this is simply yesterday, which is why
 *  the cards can honestly say "vs yesterday" there. */
export function previousPeriodBounds(period: DashboardPeriod): { start: number; end: number } {
  const { start, end } = periodBounds(period);
  const span = end - start;
  return { start: start - span, end: start };
}

/** What the delta on a KPI card compares against, in words. */
export const PERIOD_COMPARISON_LABEL: Record<DashboardPeriod, string> = {
  today: 'vs yesterday',
  weekly: 'vs previous 7 days',
  biweekly: 'vs previous 14 days',
  monthly: 'vs previous 30 days',
  yearly: 'vs previous year',
};
