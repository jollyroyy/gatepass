// Period selector for the HOD's My Passes page — Today / Last 7 Days / Last 30
// Days / Last 6 Months / Weekly / Monthly / Yearly, rendered with the same
// premium segmented control the admin and HOD dashboards use (via
// DashboardPeriodFilter's `periods` prop).
//
// This is a deliberately DIFFERENT list from the dashboards' DASHBOARD_PERIODS:
// My Passes is a history page, so it offers historical windows the dashboard
// snapshot does not. The seven options are also deliberately NOT all rolling
// windows — "Last 7 Days" and "Weekly" (and "Last 30 Days" / "Monthly") would
// otherwise mean the same thing, and the user asked for both:
//
//   rolling (ends today, includes today):  today / last7 / last30 / last6m
//   calendar-aligned (so far this …):      weekly (since Monday)
//                                          monthly (since the 1st)
//                                          yearly (since Jan 1)
//
// Every window ends at local midnight TOMORROW — the same end bound the
// dashboards use, so "Today" means the same day everywhere in the app (see
// dashboardPeriod.ts for why that day boundary matters).
export type MyPassesPeriod =
  | 'today'
  | 'last7'
  | 'last30'
  | 'last6m'
  | 'weekly'
  | 'monthly'
  | 'yearly';

export const MY_PASSES_PERIODS: { key: MyPassesPeriod; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 Days' },
  { key: 'last30', label: 'Last 30 Days' },
  { key: 'last6m', label: 'Last 6 Months' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly', label: 'Yearly' },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** `[start, end)` epoch-millis bounds in LOCAL time. `end` is always local
 *  midnight tomorrow (start of the next calendar day) — identical to
 *  `periodBounds()` in dashboardPeriod.ts, so a pass counted as "today" on the
 *  dashboard is counted as "today" here too. `start` is the window edge above:
 *  a midnight N days back for the rolling windows, or the calendar
 *  Monday / 1st / Jan 1 for the aligned ones. */
export function myPassesPeriodBounds(period: MyPassesPeriod): { start: number; end: number } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = today.getTime() + DAY_MS;

  switch (period) {
    case 'today':
      return { start: today.getTime(), end };
    case 'last7':
      return { start: today.getTime() - 6 * DAY_MS, end };
    case 'last30':
      return { start: today.getTime() - 29 * DAY_MS, end };
    case 'last6m':
      // 6 × 30 days — the same 30-day month the dashboard's "monthly" uses.
      return { start: today.getTime() - 179 * DAY_MS, end };
    case 'weekly': {
      // Monday of the current week — a week "so far", distinct from the rolling
      // Last 7 Days (which reaches back a full week no matter what day it is).
      const daysSinceMonday = (now.getDay() + 6) % 7;
      return { start: today.getTime() - daysSinceMonday * DAY_MS, end };
    }
    case 'monthly':
      return { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end };
    case 'yearly':
      return { start: new Date(now.getFullYear(), 0, 1).getTime(), end };
  }
}