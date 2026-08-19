// Pending RGP Return page — tab counts, filtering/sorting (client mock-up,
// 2026-08-19). Each case is written to fail for the right reason: the
// dashboard invariant is that a count and the list under it are two readings
// of the SAME array, so `returnTabCounts` must not read a filtered list, and
// `applyReturnFilters` must not mutate its input. `partial` is deliberately
// NOT disjoint from `dueToday`/`overdue` — a case pins that on purpose, so a
// "fix" that makes the four tabs sum to `all` would fail loudly here.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  DEFAULT_RETURN_FILTERS, RETURN_TABS, RETURN_TAB_LABELS,
  applyReturnFilters, isReturnFiltered, returnTabCounts,
  type PendingReturnFilters,
} from '../../src/lib/pendingReturnFilters';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'matched', return_status: 'awaiting_return',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: '2026-08-19', actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: '2026-08-19T04:50:00.000Z',
    is_overdue: false, is_expired: false, due_state: 'due_today',
    item_count: 1, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('returnTabCounts — over the whole list, not the filtered one', () => {
  it('counts every row under all, and dueToday/overdue are disjoint (due_state is one value)', () => {
    const rows = [
      pass({ id: 'a', due_state: 'due_today', return_status: 'awaiting_return' }),
      pass({ id: 'b', due_state: 'overdue', return_status: 'awaiting_return' }),
      pass({ id: 'c', due_state: 'due_today', return_status: 'awaiting_return' }),
    ];
    const counts = returnTabCounts(rows);
    expect(counts.all).toBe(3);
    expect(counts.dueToday).toBe(2);
    expect(counts.overdue).toBe(1);
    expect(counts.dueToday + counts.overdue).toBe(counts.all);
  });

  it('partial cuts across dueToday and overdue — a partly-returned overdue pass counts under BOTH', () => {
    const rows = [
      pass({ id: 'a', due_state: 'overdue', return_status: 'partially_returned' }),
      pass({ id: 'b', due_state: 'due_today', return_status: 'awaiting_return' }),
    ];
    const counts = returnTabCounts(rows);
    // Row 'a' is counted by overdue AND partial simultaneously — this is the
    // case that would fail if someone "fixed" the tabs into disjoint buckets.
    expect(counts.overdue).toBe(1);
    expect(counts.partial).toBe(1);
    expect(counts.all).toBe(2);
    // The three narrow counts need NOT sum to all: overdue(1) + dueToday(1) +
    // partial(1) = 3, which is more than the 2 actual rows.
    expect(counts.overdue + counts.dueToday + counts.partial).toBeGreaterThan(counts.all);
  });

  it('is not filter-aware — the same array in gives the same counts out regardless of caller narrowing', () => {
    const rows = [
      pass({ id: 'a', due_state: 'due_today' }),
      pass({ id: 'b', due_state: 'overdue' }),
    ];
    expect(returnTabCounts(rows)).toEqual(returnTabCounts(rows.slice()));
  });
});

describe('applyReturnFilters — narrows by tab, party and department', () => {
  const rows = [
    pass({
      id: 'a', due_state: 'due_today', return_status: 'awaiting_return',
      department_name: 'Engineering', visitor_name: 'Ravi', visitor_company: null,
    }),
    pass({
      id: 'b', due_state: 'overdue', return_status: 'partially_returned',
      department_name: 'Engineering',
      visitor_name: 'Sunita',
      visitor_company: JSON.stringify({ n: 'Zenith Traders', a: 'x', v: '1' }),
    }),
    pass({
      id: 'c', due_state: 'due_today', return_status: 'awaiting_return',
      department_name: 'Housekeeping', visitor_name: 'Ravi', visitor_company: null,
    }),
  ];

  it('narrows by tab alone', () => {
    const out = applyReturnFilters(rows, { ...DEFAULT_RETURN_FILTERS, tab: 'overdue' });
    expect(out.map((p) => p.id)).toEqual(['b']);
  });

  it('narrows by party through partyOf — a packed visitor_company matches on the company name, not the raw blob', () => {
    const out = applyReturnFilters(rows, { ...DEFAULT_RETURN_FILTERS, party: 'Zenith Traders' });
    expect(out.map((p) => p.id)).toEqual(['b']);
  });

  it('narrows by department alone', () => {
    const out = applyReturnFilters(rows, { ...DEFAULT_RETURN_FILTERS, department: 'Housekeeping' });
    expect(out.map((p) => p.id)).toEqual(['c']);
  });
});

describe('applyReturnFilters — sort and no-mutation', () => {
  it('does not mutate the input array — the caller`s order survives a sort-by-party call', () => {
    const rows = [
      pass({ id: 'mid', expected_return_date: '2026-08-19', visitor_name: 'Mid' }),
      pass({ id: 'early', expected_return_date: '2026-08-17', visitor_name: 'Early' }),
      pass({ id: 'late', expected_return_date: '2026-08-21', visitor_name: 'Late' }),
    ];
    const before = rows.map((p) => p.id);
    applyReturnFilters(rows, { ...DEFAULT_RETURN_FILTERS, sort: 'party' });
    expect(rows.map((p) => p.id)).toEqual(before);
  });

  it('sort: due is oldest expected date first, and a null date sorts last', () => {
    const rows = [
      pass({ id: 'mid', expected_return_date: '2026-08-19' }),
      pass({ id: 'none', expected_return_date: null }),
      pass({ id: 'early', expected_return_date: '2026-08-17' }),
    ];
    const out = applyReturnFilters(rows, { ...DEFAULT_RETURN_FILTERS, sort: 'due' });
    expect(out.map((p) => p.id)).toEqual(['early', 'mid', 'none']);
  });

  it('sort: party is A-Z by partyOf', () => {
    const rows = [
      pass({ id: 'z', visitor_name: 'Zenith', visitor_company: null }),
      pass({ id: 'a', visitor_name: 'Acme', visitor_company: null }),
      pass({ id: 'm', visitor_name: 'Mid Co', visitor_company: null }),
    ];
    const out = applyReturnFilters(rows, { ...DEFAULT_RETURN_FILTERS, sort: 'party' });
    expect(out.map((p) => p.id)).toEqual(['a', 'm', 'z']);
  });
});

describe('isReturnFiltered — false only for DEFAULT_RETURN_FILTERS', () => {
  it('is false for the default filters', () => {
    expect(isReturnFiltered(DEFAULT_RETURN_FILTERS)).toBe(false);
  });

  it('is true for a change to each of the four fields', () => {
    const deviations: PendingReturnFilters[] = [
      { ...DEFAULT_RETURN_FILTERS, tab: 'overdue' },
      { ...DEFAULT_RETURN_FILTERS, party: 'Zenith Traders' },
      { ...DEFAULT_RETURN_FILTERS, department: 'Engineering' },
      { ...DEFAULT_RETURN_FILTERS, sort: 'party' },
    ];
    for (const f of deviations) {
      expect(isReturnFiltered(f)).toBe(true);
    }
  });
});

describe('RETURN_TABS and RETURN_TAB_LABELS agree', () => {
  it('every tab has a label, and there is no label for a tab that does not exist', () => {
    expect(Object.keys(RETURN_TAB_LABELS).sort()).toEqual([...RETURN_TABS].sort());
  });
});
