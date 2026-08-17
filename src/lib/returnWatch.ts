// The RGP Return Watch — Overdue / Due Today / Due in Next 7 Days / Due After
// 7 Days.
//
// ONE FUNCTION FEEDS TWO PANELS. The "RGP Status Breakdown" donut and the "RGP
// Return Watch" tabbed table are the same four buckets drawn twice, so they
// share this module rather than each classifying passes their own way. Two
// classifiers is two chances for the ring to say 4 while the tab says 5.
//
// LATENESS IS NOT DECIDED HERE, AND MUST NOT BE. `is_overdue` and `due_state`
// are computed in `gatepass.v_gate_passes` against `site_tz()` (Asia/Kolkata);
// a screen that re-derived either would disagree with the database for every
// pass raised after 18:30 IST, and the guard at the barrier would be arguing
// with the driver about which screen is right.
//
// What this module DOES decide is the seven-day horizon, because the database
// has no opinion about it: `due_state`'s `due_soon` means TOMORROW only. That is
// a display grouping, computed from the `expected_return_date` calendar date in
// local time (see localDay.ts for why the date-only column needs its own
// parser).
import type { GatePassView } from '../types';
import type { Slice } from './boardAnalytics';
import { IS_OPEN_RETURN } from './boardDrills';
import { daysBetween, parseLocalDay } from './localDay';

export type ReturnWatchKey = 'overdue' | 'dueToday' | 'dueIn7' | 'dueLater';

/** Overdue first: the tab a reader must not have to look for. */
export const RETURN_WATCH_ORDER: readonly ReturnWatchKey[] = ['overdue', 'dueToday', 'dueIn7', 'dueLater'];

export const RETURN_WATCH_LABEL: Record<ReturnWatchKey, string> = {
  overdue: 'Overdue',
  dueToday: 'Due Today',
  dueIn7: 'Due in Next 7 Days',
  dueLater: 'Due After 7 Days',
};

/** Short form for a status pill inside a table row, where the tab above already
 *  says which bucket the reader is looking at. */
export const RETURN_WATCH_PILL: Record<ReturnWatchKey, string> = {
  overdue: 'Overdue',
  dueToday: 'Due Today',
  dueIn7: 'Due Soon',
  dueLater: 'Scheduled',
};

export const HORIZON_DAYS = 7;

/** Which bucket a pass is in, or null when it owes nothing.
 *
 *  ORDER IS THE POINT. An overdue pass is STILL awaiting return, so the obvious
 *  predicates overlap; testing overdue first is what stops one pass being
 *  counted in two buckets and the ring summing to more passes than exist. */
export function returnWatchKeyOf(p: GatePassView, now: number = Date.now()): ReturnWatchKey | null {
  if (!IS_OPEN_RETURN[p.return_status]) return null;
  if (p.is_overdue) return 'overdue';
  if (p.due_state === 'due_today') return 'dueToday';

  const due = parseLocalDay(p.expected_return_date);
  // A legacy row can carry no expected date at all. It is still out, so it is
  // still listed — dropping it would make the four tabs sum to fewer passes
  // than are actually outside, which is the one arithmetic error a reader cannot
  // detect from the screen.
  if (due === null) return 'dueLater';
  return daysBetween(now, due) <= HORIZON_DAYS ? 'dueIn7' : 'dueLater';
}

/** The four buckets, always all four and always in order — an absent tab reads
 *  as "this system has no such state", which is a stronger and wronger claim
 *  than "none right now". Each slice carries the rows it counted. */
export function returnWatchBuckets(rows: GatePassView[], now: number = Date.now()): Slice[] {
  const byKey = new Map<ReturnWatchKey, GatePassView[]>(RETURN_WATCH_ORDER.map((k) => [k, []]));
  for (const p of rows) {
    const key = returnWatchKeyOf(p, now);
    if (key) byKey.get(key)?.push(p);
  }
  return RETURN_WATCH_ORDER.map((key) => {
    const bucket = byKey.get(key) ?? [];
    return { key, label: RETURN_WATCH_LABEL[key], value: bucket.length, rows: bucket };
  });
}

/** How many whole days late, for display in the table's own column. 0 for a pass
 *  that is not late, and 0 for an overdue pass carrying no expected date —
 *  inventing a number there would be worse than printing none. */
export function daysOverdue(p: GatePassView, now: number = Date.now()): number {
  if (!p.is_overdue) return 0;
  const due = parseLocalDay(p.expected_return_date);
  if (due === null) return 0;
  return Math.max(0, daysBetween(due, now));
}
