// The RGP Return Watch — Due Today / Due in Next 7 Days / Due After 7 Days.
//
// IT LOOKS FORWARD ONLY. Overdue was a fourth bucket here until 2026-08-18, when
// the client removed it from the admin board: late material has its own page
// (`/overdue`), graded line by line, and a second, pass-level list of the same
// backlog on the dashboard was two places to read one number. An overdue pass is
// therefore in NO bucket at all — it is not quietly folded into "Due in Next 7
// Days", which would be an outright lie about a date that has already passed.
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

export type ReturnWatchKey = 'dueToday' | 'dueIn7' | 'dueLater';

/** Soonest first — the schedule reads the way a calendar does. */
export const RETURN_WATCH_ORDER: readonly ReturnWatchKey[] = ['dueToday', 'dueIn7', 'dueLater'];

export const RETURN_WATCH_LABEL: Record<ReturnWatchKey, string> = {
  dueToday: 'Due Today',
  dueIn7: 'Due in Next 7 Days',
  dueLater: 'Due After 7 Days',
};

/** Short form for a status pill inside a table row, where the tab above already
 *  says which bucket the reader is looking at. */
export const RETURN_WATCH_PILL: Record<ReturnWatchKey, string> = {
  dueToday: 'Due Today',
  dueIn7: 'Due Soon',
  dueLater: 'Scheduled',
};

export const HORIZON_DAYS = 7;

/** Which bucket a pass is in, or null when it owes nothing — or when it is
 *  already late.
 *
 *  THE `is_overdue` LINE IS LOAD-BEARING, and it must stay FIRST. An overdue
 *  pass is still awaiting return, so every predicate below would catch it: its
 *  date is in the past, so `daysBetween` is negative and it would land in "Due
 *  in Next 7 Days". Excluding it here is the whole reason the watch can be read
 *  as a forward schedule. `is_overdue` comes off `v_gate_passes`. */
export function returnWatchKeyOf(p: GatePassView, now: number = Date.now()): ReturnWatchKey | null {
  if (!IS_OPEN_RETURN[p.return_status]) return null;
  if (p.is_overdue) return null;
  if (p.due_state === 'due_today') return 'dueToday';

  const due = parseLocalDay(p.expected_return_date);
  // A legacy row can carry no expected date at all. It is still out, so it is
  // still listed — dropping it would make the four tabs sum to fewer passes
  // than are actually outside, which is the one arithmetic error a reader cannot
  // detect from the screen.
  if (due === null) return 'dueLater';
  return daysBetween(now, due) <= HORIZON_DAYS ? 'dueIn7' : 'dueLater';
}

/** The three buckets, always all three and always in order — an absent tab reads
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
