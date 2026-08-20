// Verifies each My Passes period's [start, end) bounds. Mirrors
// the dashboards' old period test but for the EIGHT My Passes periods — seven
// until 2026-08-20, when the client asked for a three-month window beside the
// six-month one — including the
// calendar-aligned ones: weekly starts on the Monday of the current week,
// monthly on the 1st of the month, yearly on Jan 1 — all ending at the same
// local-midnight-tomorrow bound the dashboards use.
import { describe, it, expect } from 'vitest';
import { MY_PASSES_PERIODS, myPassesPeriodBounds } from '../../src/lib/myPassesPeriod';

const DAY_MS = 24 * 60 * 60 * 1000;

function expectedEnd(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + DAY_MS;
}

describe('MY_PASSES_PERIODS', () => {
  it('lists exactly the eight periods, in the order the HOD asked for', () => {
    expect(MY_PASSES_PERIODS.map((p) => p.key)).toEqual([
      'today',
      'last7',
      'last30',
      'last3m',
      'last6m',
      'weekly',
      'monthly',
      'yearly',
    ]);
    expect(MY_PASSES_PERIODS.map((p) => p.label)).toEqual([
      'Today',
      'Last 7 Days',
      'Last 30 Days',
      'Last 3 Months',
      'Last 6 Months',
      'Weekly',
      'Monthly',
      'Yearly',
    ]);
  });
});

describe('myPassesPeriodBounds', () => {
  it('every period ends at the same bound: local midnight tomorrow', () => {
    const end = expectedEnd();
    for (const { key } of MY_PASSES_PERIODS) {
      expect(myPassesPeriodBounds(key).end).toBe(end);
    }
  });

  it('today spans exactly 1 day, starting at local midnight', () => {
    const { start, end } = myPassesPeriodBounds('today');
    expect(end - start).toBe(1 * DAY_MS);
  });

  it('last7 spans exactly 7 days', () => {
    const { start, end } = myPassesPeriodBounds('last7');
    expect(end - start).toBe(7 * DAY_MS);
  });

  it('last30 spans exactly 30 days', () => {
    const { start, end } = myPassesPeriodBounds('last30');
    expect(end - start).toBe(30 * DAY_MS);
  });

  it('last3m spans exactly 90 days — three 30-day months, like last6m', () => {
    const { start, end } = myPassesPeriodBounds('last3m');
    expect(end - start).toBe(90 * DAY_MS);
  });

  it('last6m spans exactly 180 days', () => {
    const { start, end } = myPassesPeriodBounds('last6m');
    expect(end - start).toBe(180 * DAY_MS);
  });

  it('weekly starts on the Monday of the current week', () => {
    const { start } = myPassesPeriodBounds('weekly');
    expect(new Date(start).getDay()).toBe(1); // 0=Sun … 1=Mon
    expect(new Date(start).getHours()).toBe(0);
    expect(new Date(start).getMinutes()).toBe(0);
    // At most one calendar week back from tomorrow — rolling Last 7 Days can
    // span up to 8 days on a Sunday, a calendar week never exceeds 7.
    expect(myPassesPeriodBounds('weekly').end - start).toBeLessThanOrEqual(7 * DAY_MS);
  });

  it('monthly starts on the 1st of the current month, at local midnight', () => {
    const now = new Date();
    const { start } = myPassesPeriodBounds('monthly');
    const d = new Date(start);
    expect(d.getFullYear()).toBe(now.getFullYear());
    expect(d.getMonth()).toBe(now.getMonth());
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
  });

  it('yearly starts on Jan 1 of the current year, at local midnight', () => {
    const now = new Date();
    const { start } = myPassesPeriodBounds('yearly');
    const d = new Date(start);
    expect(d.getFullYear()).toBe(now.getFullYear());
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
  });

  it('the calendar week never reaches further back than the rolling 7 days', () => {
    // Weekly starts on Monday, which is at most 6 days back; Last 7 Days is
    // always exactly 6 days back. So weekly.start can NEVER be the earlier.
    expect(myPassesPeriodBounds('weekly').start).toBeGreaterThanOrEqual(
      myPassesPeriodBounds('last7').start
    );
  });
});