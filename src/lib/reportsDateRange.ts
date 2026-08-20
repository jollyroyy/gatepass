// Report date-range presets + computation. Pure functions, no React.
//
// THE READY-MADE RANGES UNDER THE REPORT'S DATE SELECTION (client, 2026-08-20:
// "in all the reports across admin and HOD, under the date selection, mention
// Last 7 days / Last 30 days / Last 90 days / Last 6 months / Last 3 months /
// Last 1 month / Last 1 year"). One list, used by ONE filter bar, which both
// the admin's `/all-passes` and the HOD's `/reports` render — so the two
// screens cannot offer different windows.
//
// THE PRESETS ARE IN THE CLIENT'S OWN ORDER, not sorted by span. They named
// them in that sequence and this select is what they will read back.
//
// A DAY PRESET IS INCLUSIVE OF BOTH ENDS — "Last 7 days" is the picked day and
// the six before it, so the range covers seven calendar days and not eight. A
// MONTH/YEAR preset counts back on the calendar instead (same day, N months
// earlier), because "last 1 month" means a month ago and not thirty days ago;
// the two are deliberately both offered and are deliberately not the same
// window.
//
// EVERY DATE HERE IS LOCAL. `from`/`to` are the `YYYY-MM-DD` strings the report
// bounds with `localDayBounds`, so building them out of UTC arithmetic would
// name yesterday for five and a half hours a day in IST — the exact bug the
// two functions below already exist to prevent.

/** `custom` is not a window — it is what the select reads when the two date
 *  inputs have been moved by hand to something no preset produces. */
export type RangePreset = 'custom' | '7d' | '30d' | '90d' | '6m' | '3m' | '1m' | '1y';

export const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '6m', label: 'Last 6 months' },
  { key: '3m', label: 'Last 3 months' },
  { key: '1m', label: 'Last 1 month' },
  { key: '1y', label: 'Last 1 year' },
];

/** Whole days back for the day presets, calendar months back for the rest.
 *  A `Record` over the union, so a new preset key is a type error here rather
 *  than a select option that silently does nothing. */
const PRESET_SPAN: Record<Exclude<RangePreset, 'custom'>, { days?: number; months?: number }> = {
  '7d': { days: 6 },
  '30d': { days: 29 },
  '90d': { days: 89 },
  '6m': { months: 6 },
  '3m': { months: 3 },
  '1m': { months: 1 },
  '1y': { months: 12 },
};

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

/**
 * The inclusive `from`..`to` a preset covers, ending on `endDate` (a local
 * `YYYY-MM-DD`, normally today).
 *
 * `custom` returns the end date on both edges rather than throwing: it is a
 * label for a hand-set range, and nothing should ever ask this for one.
 */
export function presetRange(preset: RangePreset, endDate: string): DateRange {
  if (preset === 'custom') return { from: endDate, to: endDate };
  const [y, m, d] = endDate.split('-').map(Number);
  const span = PRESET_SPAN[preset];
  // Local-time constructors throughout, and month arithmetic through the Date
  // object itself so 31 May minus 1 month lands on a real date rather than on
  // "31 April". JS rolls that forward to 1 May, which is the honest answer for
  // a month that has no 31st.
  const from = new Date(y, m - 1 - (span.months ?? 0), d - (span.days ?? 0));
  return { from: localDateString(from), to: endDate };
}

/**
 * Which preset a hand-held range corresponds to, or `'custom'` when it is none
 * of them — what the select shows after the two date inputs have been moved.
 * Derived rather than remembered, so a preset the reader then edited by a day
 * cannot keep claiming to be "Last 7 days".
 */
export function presetOf(from: string, to: string, endDate: string): RangePreset {
  for (const p of RANGE_PRESETS) {
    const r = presetRange(p.key, endDate);
    if (r.from === from && r.to === to) return p.key;
  }
  return 'custom';
}
