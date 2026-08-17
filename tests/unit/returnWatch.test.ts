// The RGP Return Watch buckets — Overdue / Due Today / Due in Next 7 Days /
// Due After 7 Days. They feed BOTH the "RGP Status Breakdown" donut and the
// "RGP Return Watch" tabbed table, from one function, so the ring and the table
// can never disagree about which bucket a pass is in.
//
// LATENESS IS NEVER DECIDED HERE. `is_overdue` and `due_state` come off
// `v_gate_passes`, which compares in the site's timezone (`site_tz()`); a screen
// that re-derived them would disagree with the database for every pass raised
// after 18:30 IST. What this module DOES decide is the 7-day horizon, which the
// database has no opinion about at all (`due_state`'s `due_soon` is tomorrow
// only).
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  returnWatchKeyOf,
  returnWatchBuckets,
  RETURN_WATCH_ORDER,
  RETURN_WATCH_LABEL,
  daysOverdue,
} from '../../src/lib/returnWatch';

/** Local-midnight ISO date (YYYY-MM-DD), `offset` days from today — the shape
 *  `expected_return_date` really has (it is a `date` column, migration 001). */
function dateOnly(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function open(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-OUT-20260817-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return', is_overdue: false, is_expired: false,
    due_state: 'ok', expected_return_date: dateOnly(10), actual_return_date: null,
    created_at: new Date().toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(over as any),
  } as GatePassView;
}

describe('which watch bucket a pass falls in', () => {
  it('an overdue pass is Overdue, and is in NO other bucket', () => {
    // The overlap trap: an overdue pass is still awaiting return, so the two
    // obvious predicates would both catch it and the ring would add up to more
    // passes than exist.
    const p = open({ is_overdue: true, due_state: 'overdue', expected_return_date: dateOnly(-3) });
    expect(returnWatchKeyOf(p)).toBe('overdue');
    const buckets = returnWatchBuckets([p]);
    expect(buckets.filter((b) => b.rows.length > 0).map((b) => b.key)).toEqual(['overdue']);
  });

  it('due today comes from the view\'s own due_state, not from arithmetic here', () => {
    const p = open({ due_state: 'due_today', expected_return_date: dateOnly(0) });
    expect(returnWatchKeyOf(p)).toBe('dueToday');
  });

  it('inside seven days is dueIn7; the eighth day is dueLater', () => {
    expect(returnWatchKeyOf(open({ expected_return_date: dateOnly(1) }))).toBe('dueIn7');
    expect(returnWatchKeyOf(open({ expected_return_date: dateOnly(7) }))).toBe('dueIn7');
    expect(returnWatchKeyOf(open({ expected_return_date: dateOnly(8) }))).toBe('dueLater');
  });

  it('a pass with no expected date at all is listed, never dropped', () => {
    // A legacy row can carry a null date. Dropping it would make the tabs sum
    // to fewer passes than are actually still out.
    expect(returnWatchKeyOf(open({ expected_return_date: null, due_state: 'not_applicable' }))).toBe('dueLater');
  });

  it('a closed or non-returnable pass is in no bucket', () => {
    expect(returnWatchKeyOf(open({ return_status: 'returned' }))).toBeNull();
    expect(returnWatchKeyOf(open({ type: 'NRGP', return_status: 'not_applicable' }))).toBeNull();
    expect(returnWatchKeyOf(open({ status: 'pending', return_status: 'not_applicable' }))).toBeNull();
  });

  it('a partially returned pass is still an open obligation', () => {
    // Some lines came back, some did not — the pass still owes material, so it
    // is classified by its date like any other open pass.
    expect(returnWatchKeyOf(open({ return_status: 'partially_returned', expected_return_date: dateOnly(3) })))
      .toBe('dueIn7');
  });
});

describe('the buckets as slices', () => {
  const rows = [
    open({ id: 'o1', is_overdue: true, due_state: 'overdue', expected_return_date: dateOnly(-2) }),
    open({ id: 'o2', is_overdue: true, due_state: 'overdue', expected_return_date: dateOnly(-9) }),
    open({ id: 't1', due_state: 'due_today', expected_return_date: dateOnly(0) }),
    open({ id: 'w1', expected_return_date: dateOnly(3) }),
    open({ id: 'l1', expected_return_date: dateOnly(30) }),
    open({ id: 'closed', return_status: 'returned' }),
  ];

  it('is always the four buckets in the reference order, even when empty', () => {
    expect(returnWatchBuckets([]).map((b) => b.key)).toEqual([...RETURN_WATCH_ORDER]);
    expect(returnWatchBuckets(rows).map((b) => b.label)).toEqual(
      RETURN_WATCH_ORDER.map((k) => RETURN_WATCH_LABEL[k]),
    );
  });

  it('every value is the length of the very rows it carries', () => {
    // The board's invariant, at the level of one slice: a slice reading 2 that
    // opens 3 passes is invisible to the eye and fatal to trust.
    for (const b of returnWatchBuckets(rows)) expect(b.value).toBe(b.rows.length);
  });

  it('splits the open passes and nothing else', () => {
    const b = returnWatchBuckets(rows);
    expect(b.map((x) => x.value)).toEqual([2, 1, 1, 1]);
    expect(b.reduce((s, x) => s + x.value, 0)).toBe(5);
  });
});

describe('days overdue', () => {
  it('counts whole days late, and is 0 for a pass that is not late', () => {
    expect(daysOverdue(open({ is_overdue: true, expected_return_date: dateOnly(-3) }))).toBe(3);
    expect(daysOverdue(open({ expected_return_date: dateOnly(5) }))).toBe(0);
    expect(daysOverdue(open({ is_overdue: true, expected_return_date: null }))).toBe(0);
  });
});
