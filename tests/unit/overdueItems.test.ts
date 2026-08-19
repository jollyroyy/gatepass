// The line-level derivations `overduePasses.ts` groups into the pass-level
// cards every role's /overdue renders. The three roles differ only in which
// rows arrive — nothing here knows the role, and there is no day cut left in
// this module.
import { describe, it, expect } from 'vitest';
import { buildOverdueRows, CRITICAL_DAYS } from '../../src/lib/overdueItems';
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

describe('the line inherits the pass deadline when the pass is the earlier one', () => {
  // The bug this replaced a day cut with: RGP-20260818-0003 was due back on
  // the 18th, one of its two lines came back, and the line still outside
  // carried its own LATER date — so the return queue said "Overdue" while this
  // page counted zero.
  it('counts a line whose own date is later than its pass deadline', () => {
    const rows = buildOverdueRows(
      [pass({ expected_return_date: '2026-08-16' })],
      [item({ expected_return_date: '2026-08-18' })],
      NOW,
    );
    expect(rows.map((r) => [r.expectedReturn, r.daysLate])).toEqual([['2026-08-16', 2]]);
  });

  it('keeps the line’s own date when that is the earlier one', () => {
    const rows = buildOverdueRows(
      [pass({ expected_return_date: '2026-08-17' })],
      [item({ expected_return_date: '2026-08-15' })],
      NOW,
    );
    expect(rows[0].expectedReturn).toBe('2026-08-15');
  });

  it('falls back to whichever date exists', () => {
    expect(
      buildOverdueRows([pass({ expected_return_date: null })], [item({ expected_return_date: '2026-08-15' })], NOW)[0]
        .expectedReturn,
    ).toBe('2026-08-15');
    expect(
      buildOverdueRows([pass({ expected_return_date: '2026-08-15' })], [item({ expected_return_date: null })], NOW)[0]
        .expectedReturn,
    ).toBe('2026-08-15');
  });
});
