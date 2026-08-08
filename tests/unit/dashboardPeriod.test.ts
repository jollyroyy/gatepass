// Verifies each dashboard period's [start, end) bounds: the end is always
// local midnight tomorrow, and the span (end - start) matches the number of
// days the period claims to cover.
import { describe, it, expect } from 'vitest';
import { DASHBOARD_PERIODS, periodBounds } from '../../src/lib/dashboardPeriod';

const DAY_MS = 24 * 60 * 60 * 1000;

function expectedEnd(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() + DAY_MS;
}

describe('DASHBOARD_PERIODS', () => {
  it('lists exactly the five periods, in order, Today first', () => {
    expect(DASHBOARD_PERIODS.map((p) => p.key)).toEqual(['today', 'weekly', 'biweekly', 'monthly', 'yearly']);
    expect(DASHBOARD_PERIODS.map((p) => p.label)).toEqual(['Today', 'Weekly', 'Biweekly', 'Monthly', 'Yearly']);
  });
});

describe('periodBounds', () => {
  it('today spans exactly 1 day and ends at local midnight tomorrow', () => {
    const { start, end } = periodBounds('today');
    expect(end - start).toBe(1 * DAY_MS);
    expect(end).toBe(expectedEnd());
  });

  it('weekly spans exactly 7 days', () => {
    const { start, end } = periodBounds('weekly');
    expect(end - start).toBe(7 * DAY_MS);
    expect(end).toBe(expectedEnd());
  });

  it('biweekly spans exactly 14 days', () => {
    const { start, end } = periodBounds('biweekly');
    expect(end - start).toBe(14 * DAY_MS);
    expect(end).toBe(expectedEnd());
  });

  it('monthly spans exactly 30 days', () => {
    const { start, end } = periodBounds('monthly');
    expect(end - start).toBe(30 * DAY_MS);
    expect(end).toBe(expectedEnd());
  });

  it('yearly spans exactly 365 days', () => {
    const { start, end } = periodBounds('yearly');
    expect(end - start).toBe(365 * DAY_MS);
    expect(end).toBe(expectedEnd());
  });

  it('every period shares the same end bound', () => {
    const end = expectedEnd();
    for (const { key } of DASHBOARD_PERIODS) {
      expect(periodBounds(key).end).toBe(end);
    }
  });
});
