// Local calendar-day arithmetic, in one place.
//
// The board buckets things by DAY in three separate panels (the movement trend,
// the return watch horizon, today's activity log), and two of the columns it
// reads have different shapes:
//
//   expected_return_date  `date`        — "2026-08-17", no time, no zone.
//   verified_at / actual_return_date / created_at  `timestamptz` — a real instant.
//
// `new Date('2026-08-17')` parses as UTC midnight, which in a timezone WEST of
// UTC is the previous day — so a date-only column run through the same path as a
// timestamp silently shifts by one day for half the world. `parseLocalDay`
// splits the two cases apart instead.
//
// Local, not UTC, throughout: a pass cleared at 09:00 IST belongs to that
// morning on every screen in this app.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of the day containing `ms`. */
export function dayStart(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight of the day a column value names, or null when it names none.
 *
 *  A leading `YYYY-MM-DD` is read as a CALENDAR date in local time — that is
 *  what a `date` column means, and it is also the correct reading of the date
 *  half of a timestamp we then discard anyway. Anything else falls back to
 *  `Date` parsing so an unexpected format degrades to a best effort rather than
 *  to NaN arithmetic. */
export function parseLocalDay(value: string | null | undefined): number | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : dayStart(t);
}

/** Whole days from day `a` to day `b` — positive when `b` is later. Both are
 *  snapped to local midnight first, so the answer is a count of calendar days
 *  and never 0.97 of one. */
export function daysBetween(a: number, b: number): number {
  return Math.round((dayStart(b) - dayStart(a)) / DAY_MS);
}

/** Local midnight `days` days before the midnight containing `from`. */
export function dayStartBefore(from: number, days: number): number {
  return dayStart(from) - days * DAY_MS;
}

export { DAY_MS };
