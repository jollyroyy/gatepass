// The Reports page used to bound "Today" with UTC midnights
// (`T00:00:00Z..T23:59:59Z`), while every dashboard KPI bounds today with
// LOCAL midnight (`todayBounds`). In a UTC+5:30 timezone that made a
// "Today" report span 05:30 IST yesterday → 05:29 IST today — the report and
// the dashboard disagreed for 5.5 hours a day. These tests pin the local-day
// convention so the mismatch cannot silently return.
import { describe, expect, it } from 'vitest';
import {
  localDateString,
  localDayBounds,
  presetOf,
  presetRange,
  RANGE_PRESETS,
} from '../../src/lib/reportsDateRange';

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

// THE READY-MADE RANGES (client, 2026-08-20). `computeDateRange` and its
// 'today' | '7d' | '30d' | '3m' | '1y' union were REPLACED by these — that
// function had lost its last caller when the Reports toolbar was deleted for
// the report mock-up, and its preset set was not the one the client asked for.
describe('presetRange', () => {
  it('offers exactly the seven ranges the client named, in their order', () => {
    expect(RANGE_PRESETS.map((p) => p.label)).toEqual([
      'Last 7 days',
      'Last 30 days',
      'Last 90 days',
      'Last 6 months',
      'Last 3 months',
      'Last 1 month',
      'Last 1 year',
    ]);
  });

  it('counts a day preset inclusively of both ends', () => {
    // Seven calendar days ending on the 8th is the 2nd..8th, not the 1st..8th.
    expect(presetRange('7d', '2026-08-08')).toEqual({ from: '2026-08-02', to: '2026-08-08' });
    expect(presetRange('30d', '2026-08-08')).toEqual({ from: '2026-07-10', to: '2026-08-08' });
    expect(presetRange('90d', '2026-08-08')).toEqual({ from: '2026-05-11', to: '2026-08-08' });
  });

  it('counts a month preset on the CALENDAR, so it is not the same window as a day preset', () => {
    expect(presetRange('1m', '2026-08-08')).toEqual({ from: '2026-07-08', to: '2026-08-08' });
    expect(presetRange('3m', '2026-08-08')).toEqual({ from: '2026-05-08', to: '2026-08-08' });
    expect(presetRange('6m', '2026-08-08')).toEqual({ from: '2026-02-08', to: '2026-08-08' });
    expect(presetRange('1y', '2026-08-08')).toEqual({ from: '2025-08-08', to: '2026-08-08' });
    // "Last 1 month" and "Last 30 days" are both offered and are different.
    expect(presetRange('1m', '2026-08-08').from).not.toBe(presetRange('30d', '2026-08-08').from);
  });

  it('rolls a month-end back onto a real date rather than an impossible one', () => {
    // 31 May minus one month is not "31 April" — JS names 1 May, which is the
    // honest answer for a month that has no 31st.
    expect(presetRange('1m', '2026-05-31')).toEqual({ from: '2026-05-01', to: '2026-05-31' });
  });

  it('crosses a year boundary on the calendar, not by 365 days', () => {
    expect(presetRange('3m', '2026-01-15')).toEqual({ from: '2025-10-15', to: '2026-01-15' });
  });
});

describe('presetOf', () => {
  it('names the preset a range came from', () => {
    for (const p of RANGE_PRESETS) {
      const r = presetRange(p.key, '2026-08-08');
      expect(presetOf(r.from, r.to, '2026-08-08')).toBe(p.key);
    }
  });

  it("reads 'custom' once the reader moves an edge by a day", () => {
    expect(presetOf('2026-08-03', '2026-08-08', '2026-08-08')).toBe('custom');
    // Same span, different end date — not a preset ending today either.
    expect(presetOf('2026-08-01', '2026-08-07', '2026-08-08')).toBe('custom');
  });
});
