// Overdue Items is a LINE-level page, and every figure on it is derived here.
// The three scopes (admin all-time, HOD own, guard today) differ only in which
// rows arrive and in `scopeOverdue` — nothing else on the page knows the role.
import { describe, it, expect } from 'vitest';
import {
  buildOverdueRows, overdueStats, overdueTrend, filterOverdue,
  scopeOverdue, departmentsOf, hasActiveFilters, formatDelay, CRITICAL_DAYS,
  EMPTY_FILTERS,
} from '../../src/lib/overdueItems';
import type { GatePassItemView, GatePassView } from '../../src/types';

/** 18 Aug 2026, local noon — the same "today" every case below reads. */
const NOW = new Date(2026, 7, 18, 12, 0, 0).getTime();

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260818-0001', type: 'RGP',
    expected_return_date: '2026-08-17', visitor_name: 'Rohan Sharma',
    department_id: 'd1', department_name: 'Engineering',
    return_status: 'awaiting_return',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Fluke Multimeter', quantity: 2,
    unit: 'nos', returned_qty: 0, outstanding_qty: 2, expected_return_date: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('buildOverdueRows', () => {
  it('counts whole calendar days late from the line date, worst first', () => {
    const rows = buildOverdueRows(
      [pass({}), pass({ id: 'p2', pass_number: 'RGP-OUT-20260810-0002', expected_return_date: '2026-08-12' })],
      [item({}), item({ id: 'i2', gate_pass_id: 'p2' })],
      NOW,
    );
    expect(rows.map((r) => r.daysLate)).toEqual([6, 1]);
    expect(rows[0].pass.pass_number).toBe('RGP-OUT-20260810-0002');
  });

  it('prefers the line own date over its pass date', () => {
    const rows = buildOverdueRows([pass({})], [item({ expected_return_date: '2026-08-15' })], NOW);
    expect(rows[0].expectedReturn).toBe('2026-08-15');
    expect(rows[0].daysLate).toBe(3);
  });

  it('is not late on the day it is due, and never negative', () => {
    expect(buildOverdueRows([pass({ expected_return_date: '2026-08-18' })], [item({})], NOW)).toHaveLength(0);
    expect(buildOverdueRows([pass({ expected_return_date: '2026-08-25' })], [item({})], NOW)).toHaveLength(0);
  });

  it('leaves out a fully returned line, keeps a partially returned one', () => {
    const rows = buildOverdueRows(
      [pass({})],
      [
        item({ id: 'back', returned_qty: 2, outstanding_qty: 0 }),
        item({ id: 'half', returned_qty: 1, outstanding_qty: 1 }),
      ],
      NOW,
    );
    expect(rows.map((r) => r.item.id)).toEqual(['half']);
  });

  it('never counts an NRGP line — it has no return leg at all', () => {
    expect(buildOverdueRows([pass({ type: 'NRGP', return_status: 'not_applicable' })], [item({})], NOW)).toHaveLength(0);
  });

  it('drops an undated legacy line rather than inventing a delay', () => {
    expect(buildOverdueRows([pass({ expected_return_date: null })], [item({})], NOW)).toHaveLength(0);
  });

  it('drops a line whose pass is out of scope — scope is the caller’s', () => {
    expect(buildOverdueRows([pass({})], [item({ gate_pass_id: 'someone-else' })], NOW)).toHaveLength(0);
  });

  it(`grades ${CRITICAL_DAYS}+ days late as critical`, () => {
    const rows = buildOverdueRows(
      [pass({}), pass({ id: 'p2', expected_return_date: '2026-08-15' })],
      [item({}), item({ id: 'i2', gate_pass_id: 'p2' })],
      NOW,
    );
    expect(rows.map((r) => r.severity)).toEqual(['critical', 'overdue']);
  });
});

describe('scopeOverdue', () => {
  const rows = buildOverdueRows(
    [
      pass({}),
      pass({ id: 'p2', expected_return_date: '2026-08-01' }),
    ],
    [item({}), item({ id: 'i2', gate_pass_id: 'p2' })],
    NOW,
  );

  it('gives the guard only what went overdue today', () => {
    expect(scopeOverdue(rows, 'today').map((r) => r.daysLate)).toEqual([1]);
  });

  it('gives the admin and the HOD every missed day', () => {
    expect(scopeOverdue(rows, 'all')).toHaveLength(2);
  });
});

describe('the stat tiles', () => {
  const passes = [pass({}), pass({ id: 'p2', expected_return_date: '2026-08-10' })];
  const items = [item({}), item({ id: 'i2', gate_pass_id: 'p2' })];

  it('counts the rows and grades the critical ones', () => {
    expect(overdueStats(buildOverdueRows(passes, items, NOW))).toEqual({ total: 2, critical: 1 });
    expect(overdueStats([])).toEqual({ total: 0, critical: 0 });
  });

  it('names a delay in days, singular and plural', () => {
    expect(formatDelay(1)).toBe('1 day');
    expect(formatDelay(6)).toBe('6 days');
  });
});

describe('overdueTrend', () => {
  it('plots how much of this backlog was already late on each of the last days', () => {
    const rows = buildOverdueRows(
      [pass({}), pass({ id: 'p2', expected_return_date: '2026-08-14' })],
      [item({}), item({ id: 'i2', gate_pass_id: 'p2' })],
      NOW,
    );
    const bars = overdueTrend(rows, NOW, 7);
    expect(bars).toHaveLength(7);
    expect(bars[bars.length - 1].count).toBe(2);
    // The window is 12–18 Aug. On 15 Aug only the 14 Aug line was past its date.
    expect(bars[3].count).toBe(1);
    expect(bars[0].count).toBe(0);
  });
});

describe('filters', () => {
  const rows = buildOverdueRows(
    [
      pass({}),
      pass({ id: 'p2', department_id: 'd2', department_name: 'Housekeeping', expected_return_date: '2026-08-05' }),
    ],
    [item({}), item({ id: 'i2', gate_pass_id: 'p2' })],
    NOW,
  );

  it('narrows by department', () => {
    expect(filterOverdue(rows, { department: 'd2', delay: 'any' })).toHaveLength(1);
  });

  it('narrows by delay band, using the one critical threshold', () => {
    expect(filterOverdue(rows, { department: 'all', delay: 'critical' }).map((r) => r.daysLate)).toEqual([13]);
    expect(filterOverdue(rows, { department: 'all', delay: 'lt3' }).map((r) => r.daysLate)).toEqual([1]);
    expect(filterOverdue(rows, EMPTY_FILTERS)).toHaveLength(2);
  });

  it('offers only departments that are actually in the rows', () => {
    expect(departmentsOf(rows).map((d) => d.name)).toEqual(['Engineering', 'Housekeeping']);
  });

  it('knows when anything is narrowing the list', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters({ department: 'all', delay: 'week' })).toBe(true);
  });
});
