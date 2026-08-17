// Report date-range presets + computation. Pure function, no React — the
// Reports toolbar owns a `date` (YYYY-MM-DD) and a `preset`, and this turns
// them into inclusive from/to dates. The from edge is a calendar *day* count
// back from the end date, so '7d' is a rolling 7-day window ending on the
// picked date, exactly like the VMS register toolbar this was adapted from.
export type RangePreset = 'today' | '7d' | '30d' | '3m' | '1y';

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
  { key: '3m', label: 'Last 3 Months' },
  { key: '1y', label: 'Last 1 Year' },
];

export type DateRange = { from: string; to: string };

/** `YYYY-MM-DD` in the LIFTS LOCAL timezone. The old `new Date().toISOString().slice(0, 10)`
 *  is UTC — between 00:00 and 05:30 IST it names YESTERDAY, so a "Today" report
 *  silently looked at the wrong day and the toolbar's max date sat behind the one
 *  the dashboards call today. */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local-midnight bounds `[start, end)` for an inclusive `from`..`to` day range.
 *  The dashboards (`todayBounds` in hodKpis.ts) define "today" as local midnight to
 *  local midnight; reports must use the SAME day or a "Today" report and the
 *  "Today" KPI disagree for five and a half hours a day (report UTC bounds
 *  00:00Z..23:59Z span 05:30 IST today → 05:29 IST tomorrow). */
export function localDayBounds(from: string, to: string): { start: number; end: number } {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = new Date(fy, fm - 1, fd).getTime();
  const end = new Date(ty, tm - 1, td + 1).getTime();
  return { start, end };
}

export function computeDateRange(preset: RangePreset, endDate: string): DateRange {
  const end = new Date(`${endDate}T00:00:00Z`);
  const from = new Date(end);
  switch (preset) {
    case 'today': break;
    case '7d': from.setUTCDate(from.getUTCDate() - 6); break;
    case '30d': from.setUTCDate(from.getUTCDate() - 29); break;
    case '3m': from.setUTCMonth(from.getUTCMonth() - 3); break;
    case '1y': from.setUTCFullYear(from.getUTCFullYear() - 1); break;
  }
  return { from: from.toISOString().slice(0, 10), to: endDate };
}
