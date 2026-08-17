// The Reports page used to bound "Today" with UTC midnights
// (`T00:00:00Z..T23:59:59Z`), while every dashboard KPI bounds today with
// LOCAL midnight (`todayBounds`). In a UTC+5:30 timezone that made a
// "Today" report span 05:30 IST yesterday → 05:29 IST today — the report and
// the dashboard disagreed for 5.5 hours a day. These tests pin the local-day
// convention so the mismatch cannot silently return.
import { describe, expect, it } from 'vitest';
import { computeDateRange, localDateString, localDayBounds } from '../../src/lib/reportsDateRange';

// localDayBounds is intentionally TZ-agnostic in its EXPECTED values: both
// sides use the same local-time constructors, so the assertions are true in
// every timezone the suite might run in.
describe('localDayBounds', () => {
  it('bounds a single day as [local midnight, next local midnight)', () => {
    const { start, end } = localDayBounds('2026-08-08', '2026-08-08');
    expect(start).toBe(new Date(2026, 7, 8).getTime());
    expect(end).toBe(new Date(2026, 7, 9).getTime());
    expect(end - start).toBe(24 * 60 * 60 * 1000);
  });

  it('a row created at 23:59:59 local belongs to the day, one at 00:00:30 the next morning does not', () => {
    const { start, end } = localDayBounds('2026-08-08', '2026-08-08');
    const lateContestant = new Date(2026, 7, 8, 23, 59, 59, 999).getTime();
    const nextDayEarly = new Date(2026, 7, 9, 0, 0, 30).getTime();
    expect(lateContestant).toBeGreaterThanOrEqual(start);
    expect(lateContestant).toBeLessThan(end);
    expect(nextDayEarly).toBeGreaterThanOrEqual(end);
  });

  it('an 8-day range spans from the first day’s local midnight to the day AFTER the last', () => {
    const { start, end } = localDayBounds('2026-08-01', '2026-08-08');
    expect(start).toBe(new Date(2026, 7, 1).getTime());
    expect(end).toBe(new Date(2026, 7, 9).getTime());
  });
});

describe('localDateString', () => {
  it('formats a date in local calendar time, not UTC', () => {
    // 2026-08-08 23:00 IST == 17:30 UTC the SAME day; use a local-clock
    // instant right before midnight to prove the string follows the local
    // calendar, not the UTC one.
    const d = new Date(2026, 7, 8, 23, 45);
    expect(localDateString(d)).toBe('2026-08-08');
  });

  it('pads month and day to two digits', () => {
    expect(localDateString(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(localDateString(new Date(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('computeDateRange', () => {
  it('keeps the calendar-day preset arithmetic', () => {
    expect(computeDateRange('today', '2026-08-08')).toEqual({ from: '2026-08-08', to: '2026-08-08' });
    expect(computeDateRange('7d', '2026-08-08')).toEqual({ from: '2026-08-02', to: '2026-08-08' });
    expect(computeDateRange('30d', '2026-08-08')).toEqual({ from: '2026-07-10', to: '2026-08-08' });
  });
});