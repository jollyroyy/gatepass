// Overdue Items — the derivations behind the page all three roles get.
//
// ONE ROW IS ONE MATERIAL LINE, never a pass. A pass with three lines can have
// one back and two still outside; the thing somebody has to chase is the line.
// Same rule as the Scheduled Returns table, and the same stage function
// (`itemReturnStage`), so a line cannot read "Pending" on one screen and
// "Returned" on the other.
//
// LATENESS IS A COUNT OF CALENDAR DAYS, not hours. `expected_return_date` is a
// `date` column — no time, no zone — so "1d 7h late" would be an invented
// figure. `parseLocalDay` reads it as a local calendar day (see localDay.ts:
// `new Date('2026-08-17')` is UTC midnight and slips a day west of UTC).
//
// SCOPE IS THE CALLER'S, NOT THIS MODULE'S. Which passes arrive here is decided
// by the page — RLS plus `raised_by` for an HOD, everything for an admin — and
// the day cut for the guard is `scopeOverdue`. Nothing below widens a set.
import type { GatePassItemView, GatePassView } from '../types';
import type { StatusStyle } from './statusStyles';
import { itemReturnStage } from './passRecordView';
import type { Slice } from './boardAnalytics';
import { dayStart, daysBetween, parseLocalDay, DAY_MS } from './localDay';

/** Days late at which a line stops being a chase and becomes an escalation.
 *  One threshold, used by the tile, the badge, the filter and the escalation
 *  panel — so the four can never disagree about what "critical" means. */
export const CRITICAL_DAYS = 3;

export type OverdueSeverity = 'overdue' | 'critical';

/** Direct lookup, never an includes() chain. The hues are the app's status
 *  hues: orange is what an overdue pass badge already is, and red is what a
 *  pass demanding a decision already is — a line that has been out a week
 *  should not introduce a third vocabulary. */
export const OVERDUE_STYLES: Record<OverdueSeverity, StatusStyle> = {
  overdue: { bg: 'bg-overdue-50', text: 'text-overdue-700', dot: 'bg-overdue-500', label: 'Overdue' },
  critical: { bg: 'bg-flagged-50', text: 'text-flagged-700', dot: 'bg-flagged-500', label: 'Critical' },
};

export interface OverdueRow {
  item: GatePassItemView;
  pass: GatePassView;
  /** The line's own expected date when it carries one, else the pass's. */
  expectedReturn: string;
  /** Whole calendar days past the expected date. Always >= 1 — a line due
   *  today is not late yet. */
  daysLate: number;
  severity: OverdueSeverity;
}

/** A line still owes material: RGP, and not everything has come back. NRGP has
 *  no return leg at all, so it can never be overdue. */
function isOutstanding(item: GatePassItemView, pass: GatePassView): boolean {
  const stage = itemReturnStage(item, pass.type);
  return stage === 'pending' || stage === 'partial';
}

function expectedOf(item: GatePassItemView, pass: GatePassView): string | null {
  return item.expected_return_date ?? pass.expected_return_date ?? null;
}

/**
 * Every outstanding line whose expected date has passed, worst delay first.
 *
 * A line with NO expected date is not overdue — it is undated, which is a
 * legacy-data fact rather than a late one, and printing it as "∞ days late"
 * would put a number on the screen that nothing supports.
 */
export function buildOverdueRows(
  passes: GatePassView[],
  items: GatePassItemView[],
  now: number = Date.now(),
): OverdueRow[] {
  const today = dayStart(now);
  const byPass = new Map(passes.map((p) => [p.id, p]));
  const rows: OverdueRow[] = [];

  for (const item of items) {
    const pass = byPass.get(item.gate_pass_id);
    if (!pass || !isOutstanding(item, pass)) continue;
    const expected = expectedOf(item, pass);
    const day = parseLocalDay(expected);
    if (day === null || expected === null) continue;
    const daysLate = daysBetween(day, today);
    if (daysLate < 1) continue;
    rows.push({
      item,
      pass,
      expectedReturn: expected,
      daysLate,
      severity: daysLate >= CRITICAL_DAYS ? 'critical' : 'overdue',
    });
  }

  return rows.sort((a, b) => {
    if (a.daysLate !== b.daysLate) return b.daysLate - a.daysLate;
    if (a.pass.pass_number !== b.pass.pass_number) {
      return a.pass.pass_number < b.pass.pass_number ? -1 : 1;
    }
    return a.item.line_no - b.item.line_no;
  });
}

/** The page's two counts. `total` is the one FIGURE on screen; `critical` is
 *  not a tile any more (client, 2026-08-18) but is still what the escalation
 *  panel and the delay filter read, so it stays. Both are `rows.length` of an
 *  array the page also holds — the board's invariant. */
export interface OverdueStats {
  total: number;
  critical: number;
}

export function overdueStats(rows: OverdueRow[]): OverdueStats {
  return {
    total: rows.length,
    critical: rows.filter((r) => r.severity === 'critical').length,
  };
}

/** "3 days" / "1 day". Days, because days are what the data holds. */
export function formatDelay(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

export interface TrendBar {
  /** Local midnight of the day. */
  day: number;
  /** "13 Aug" — the axis label. */
  label: string;
  count: number;
}

/**
 * How many of these lines were already past their date on each of the last
 * `days` days, oldest first.
 *
 * Built from the rows themselves — no second query, and no history table.
 * A line still outstanding today was outstanding on every earlier day too
 * (`returned_qty` only ever increases), so "was it past its date on day D" is
 * decided by its date alone. A line returned before today is therefore absent
 * from every bar, including the ones where it was genuinely late: this is a
 * picture of the CURRENT backlog's age, not an archive of past lateness.
 */
export function overdueTrend(rows: OverdueRow[], now: number = Date.now(), days = 7): TrendBar[] {
  const today = dayStart(now);
  const out: TrendBar[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = today - i * DAY_MS;
    const count = rows.filter((r) => {
      const d = parseLocalDay(r.expectedReturn);
      return d !== null && d < day;
    }).length;
    out.push({
      day,
      label: new Date(day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }),
      count,
    });
  }
  return out;
}

/** The delay bands of the filter bar. `critical` is the same threshold the
 *  severity badge uses — one definition, four readers. */
export type DelayFilter = 'any' | 'lt3' | 'critical' | 'week';

export const DELAY_FILTER_LABELS: Record<DelayFilter, string> = {
  any: 'Delay: Any',
  lt3: 'Under 3 days',
  critical: '3 days or more',
  week: 'A week or more',
};

const DELAY_MATCH: Record<DelayFilter, (days: number) => boolean> = {
  any: () => true,
  lt3: (d) => d < CRITICAL_DAYS,
  critical: (d) => d >= CRITICAL_DAYS,
  week: (d) => d >= 7,
};

export interface OverdueFilterState {
  /** A `public.departments` id, or 'all'. */
  department: string;
  delay: DelayFilter;
}

export const EMPTY_FILTERS: OverdueFilterState = { department: 'all', delay: 'any' };

export function filterOverdue(rows: OverdueRow[], f: OverdueFilterState): OverdueRow[] {
  return rows.filter(
    (r) =>
      (f.department === 'all' || r.pass.department_id === f.department) &&
      DELAY_MATCH[f.delay](r.daysLate),
  );
}

export function hasActiveFilters(f: OverdueFilterState): boolean {
  return f.department !== 'all' || f.delay !== 'any';
}

/**
 * The guard's day cut: lines that BECAME overdue today — expected back
 * yesterday, still out this morning. Everything older is the admin's backlog,
 * not this shift's chase.
 *
 * 'all' is the admin and the HOD: every missed date, however old.
 */
export type OverdueScope = 'today' | 'all';

export function scopeOverdue(rows: OverdueRow[], scope: OverdueScope): OverdueRow[] {
  return scope === 'all' ? rows : rows.filter((r) => r.daysLate === 1);
}

/** Departments present in a set of rows, named, for the filter select. Built
 *  from the rows themselves so the select can never offer a department that
 *  filters to nothing. */
export function departmentsOf(rows: OverdueRow[]): { id: string; name: string }[] {
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.pass.department_id, r.pass.department_name);
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

/**
 * Overdue LINES per department, biggest first — the bar chart on the admin's
 * Overdue tab (client, 2026-08-18: "a bar chart of which department has the
 * department-wise overdue items").
 *
 * Counts ROWS, which on this page are material lines, not passes: a pass with
 * three lines still out is three things to chase, and the table beside the
 * chart is counted the same way. Returns an empty array when nothing is
 * overdue — a chart of zeroes says less than a sentence does.
 */
export function overdueByDepartment(rows: OverdueRow[]): Slice[] {
  const buckets = new Map<string, Slice>();
  for (const r of rows) {
    const key = r.pass.department_id ?? 'unassigned';
    const slice = buckets.get(key)
      ?? { key, label: r.pass.department_name ?? 'Unassigned', value: 0, rows: [] };
    slice.value += 1;
    slice.rows.push(r.pass);
    buckets.set(key, slice);
  }
  return [...buckets.values()]
    .sort((a, b) => (b.value - a.value) || (a.label < b.label ? -1 : 1));
}

/**
 * Which return desk a pass belongs on right now — the destination of every
 * "record this return" link outside these two pages.
 *
 * `due_state` is the DATABASE's grading, in `site_tz()`; never compare
 * `expected_return_date` to the browser clock. A pass that is neither overdue
 * nor due today still lands on Returns Due Today, which says plainly that
 * nothing is expected back — better than an Overdue page that does not list it.
 */
export function returnDeskFor(pass: Pick<GatePassView, 'due_state'>): string {
  return pass.due_state === 'overdue' ? '/overdue' : '/returns';
}
