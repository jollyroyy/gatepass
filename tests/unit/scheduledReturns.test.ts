// The Awaiting Return drill is a table of MATERIAL LINES, so the derivations
// under it are line-level: which pass a line belongs to, when it is due, and
// which page it lands on.
import { describe, it, expect } from 'vitest';
import { buildScheduledReturns, pageOf } from '../../src/lib/scheduledReturns';
import type { GatePassItemView, GatePassView } from '../../src/types';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'p1', pass_number: 'RGP-OUT-20260818-0001', type: 'RGP',
    expected_return_date: '2026-08-18', visitor_name: 'Rohan Sharma',
    department_name: 'Engineering', return_status: 'awaiting_return',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function item(over: Partial<GatePassItemView>): GatePassItemView {
  return {
    id: 'i1', gate_pass_id: 'p1', line_no: 1, name: 'Drill', quantity: 2,
    unit: 'nos', returned_qty: 0, outstanding_qty: 2, expected_return_date: null,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('buildScheduledReturns', () => {
  it('joins each line to its pass and grades it', () => {
    const rows = buildScheduledReturns([pass({})], [item({}), item({ id: 'i2', line_no: 2, returned_qty: 2, outstanding_qty: 0 })]);
    expect(rows.map((r) => r.stage)).toEqual(['pending', 'returned']);
    expect(rows[0].pass.pass_number).toBe('RGP-OUT-20260818-0001');
  });

  it('drops a line whose pass is not in the drill', () => {
    expect(buildScheduledReturns([pass({})], [item({ gate_pass_id: 'other' })])).toHaveLength(0);
  });

  it('prefers the line date over the pass date, and sorts oldest first', () => {
    const rows = buildScheduledReturns(
      [pass({}), pass({ id: 'p2', pass_number: 'RGP-OUT-20260818-0002', expected_return_date: '2026-08-10' })],
      [item({}), item({ id: 'i2', gate_pass_id: 'p2' }), item({ id: 'i3', expected_return_date: '2026-08-01' })]
    );
    expect(rows.map((r) => r.expectedReturn)).toEqual(['2026-08-01', '2026-08-10', '2026-08-18']);
  });

  it('sorts a dateless legacy line last, not first', () => {
    const rows = buildScheduledReturns(
      [pass({ expected_return_date: null }), pass({ id: 'p2', pass_number: 'RGP-OUT-20260818-0002', expected_return_date: '2026-08-20' })],
      [item({}), item({ id: 'i2', gate_pass_id: 'p2' })]
    );
    expect(rows[0].expectedReturn).toBe('2026-08-20');
    expect(rows[1].expectedReturn).toBeNull();
  });
});

describe('pageOf', () => {
  const rows = Array.from({ length: 18 }, (_, i) => i);

  it('reports the 1-based window a reader sees', () => {
    expect(pageOf(rows, 1, 5)).toMatchObject({ from: 1, to: 5, total: 18, pages: 4, page: 1 });
    expect(pageOf(rows, 4, 5)).toMatchObject({ from: 16, to: 18, page: 4 });
  });

  it('clamps a page past either end rather than showing nothing', () => {
    expect(pageOf(rows, 99, 5).page).toBe(4);
    expect(pageOf(rows, 0, 5).page).toBe(1);
  });

  it('is 0 of 0 on an empty set, never NaN', () => {
    expect(pageOf([], 1, 5)).toMatchObject({ from: 0, to: 0, total: 0, pages: 1 });
  });
});
