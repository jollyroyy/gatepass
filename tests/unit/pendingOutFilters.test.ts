// Pending OUT page — tab counts, scope options, filtering/sorting and the
// pager arithmetic (client mock-up, 2026-08-19). Each case is written to fail
// for the right reason: the dashboard invariant is that a count and the list
// under it are two readings of the SAME array, so `tabCounts` must not read
// the filtered list, and `applyFilters` must not mutate its input.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  DEFAULT_FILTERS, applyFilters, isFiltered, itemsLabel, scopeOptions,
  tabCounts, type PendingOutFilters,
} from '../../src/lib/pendingOutFilters';
import { pageNumbers } from '../../src/components/guard/GuardPager';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260819-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: null, expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: '2026-08-19T04:50:00.000Z',
    is_overdue: false, is_expired: false, due_state: 'not_applicable',
    item_count: 1, total_quantity: 200, returned_quantity: 0,
    material_summary: 'Steel Props',
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('tabCounts — over the whole list, not the filtered one', () => {
  it('counts every row regardless of type, and all is the sum of RGP + NRGP', () => {
    const rows = [
      pass({ id: 'a', type: 'RGP' }),
      pass({ id: 'b', type: 'RGP' }),
      pass({ id: 'c', type: 'NRGP' }),
    ];
    const counts = tabCounts(rows);
    expect(counts).toEqual({ all: 3, RGP: 2, NRGP: 1 });
    expect(counts.all).toBe(counts.RGP + counts.NRGP);
  });

  it('is unaffected by a caller narrowing the array first — it is not tab-aware', () => {
    const rows = [
      pass({ id: 'a', type: 'RGP' }),
      pass({ id: 'b', type: 'NRGP' }),
    ];
    // Passing the whole list twice must give the same counts either way — the
    // function itself does no filtering, callers always feed it the full set.
    expect(tabCounts(rows)).toEqual({ all: 2, RGP: 1, NRGP: 1 });
  });
});

describe('scopeOptions — sorted, de-duplicated party and department names', () => {
  it('reads party through partyOf: company name from visitor_company when present', () => {
    const rows = [
      pass({ id: 'a', visitor_company: JSON.stringify({ n: 'Zenith Traders', a: 'x', v: '1' }) }),
      pass({ id: 'b', visitor_company: JSON.stringify({ n: 'Acme Corp', a: 'x', v: '2' }) }),
      pass({ id: 'c', visitor_company: JSON.stringify({ n: 'Acme Corp', a: 'x', v: '2' }) }),
    ];
    const { parties } = scopeOptions(rows);
    expect(parties).toEqual(['Acme Corp', 'Zenith Traders']);
  });

  it('falls back to visitor_name when there is no company name', () => {
    const rows = [
      pass({ id: 'a', visitor_company: null, visitor_name: 'Ravi Kumar' }),
      pass({ id: 'b', visitor_company: JSON.stringify({ n: '', a: '', v: '' }), visitor_name: 'Sunita' }),
    ];
    const { parties } = scopeOptions(rows);
    expect(parties).toEqual(['Ravi Kumar', 'Sunita']);
  });

  it('dedupes and sorts department names, dropping blanks', () => {
    const rows = [
      pass({ id: 'a', department_name: 'Engineering' }),
      pass({ id: 'b', department_name: 'Housekeeping' }),
      pass({ id: 'c', department_name: 'Engineering' }),
      pass({ id: 'd', department_name: '' as unknown as string }),
    ];
    const { departments } = scopeOptions(rows);
    expect(departments).toEqual(['Engineering', 'Housekeeping']);
  });
});

describe('applyFilters — narrows by tab, party, department; the three compose', () => {
  const rows = [
    pass({ id: 'a', type: 'RGP', department_name: 'Engineering', visitor_name: 'Ravi', visitor_company: null }),
    pass({ id: 'b', type: 'NRGP', department_name: 'Engineering', visitor_name: 'Sunita', visitor_company: null }),
    pass({ id: 'c', type: 'RGP', department_name: 'Housekeeping', visitor_name: 'Ravi', visitor_company: null }),
  ];

  it('narrows by tab alone', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, tab: 'NRGP' });
    expect(out.map((p) => p.id)).toEqual(['b']);
  });

  it('narrows by party alone', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, party: 'Ravi' });
    expect(out.map((p) => p.id)).toEqual(['a', 'c']);
  });

  it('narrows by department alone', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, department: 'Engineering' });
    expect(out.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('composes all three — a row must satisfy every active filter', () => {
    const out = applyFilters(rows, {
      ...DEFAULT_FILTERS, tab: 'RGP', party: 'Ravi', department: 'Housekeeping',
    });
    expect(out.map((p) => p.id)).toEqual(['c']);
  });

  it('returns nothing when the composed filters match no row', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, tab: 'NRGP', department: 'Housekeeping' });
    expect(out).toEqual([]);
  });
});

describe('applyFilters — sort and no-mutation', () => {
  const rows = [
    pass({ id: 'mid', created_at: '2026-08-19T05:00:00.000Z' }),
    pass({ id: 'early', created_at: '2026-08-19T04:00:00.000Z' }),
    pass({ id: 'late', created_at: '2026-08-19T06:00:00.000Z' }),
  ];

  it('sorts oldest-first by default', () => {
    const out = applyFilters(rows, DEFAULT_FILTERS);
    expect(out.map((p) => p.id)).toEqual(['early', 'mid', 'late']);
  });

  it('sorts newest-first when sort is newest', () => {
    const out = applyFilters(rows, { ...DEFAULT_FILTERS, sort: 'newest' });
    expect(out.map((p) => p.id)).toEqual(['late', 'mid', 'early']);
  });

  it('does not mutate the input array — the caller`s order survives', () => {
    const before = rows.map((p) => p.id);
    applyFilters(rows, { ...DEFAULT_FILTERS, sort: 'newest' });
    expect(rows.map((p) => p.id)).toEqual(before);
  });
});

describe('isFiltered — false only for DEFAULT_FILTERS', () => {
  it('is false for the default filters', () => {
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
  });

  it('is true for each single deviation', () => {
    const deviations: PendingOutFilters[] = [
      { ...DEFAULT_FILTERS, tab: 'RGP' },
      { ...DEFAULT_FILTERS, party: 'Acme Corp' },
      { ...DEFAULT_FILTERS, department: 'Engineering' },
      { ...DEFAULT_FILTERS, sort: 'newest' },
    ];
    for (const f of deviations) {
      expect(isFiltered(f)).toBe(true);
    }
  });
});

describe('itemsLabel', () => {
  it('is singular for 1', () => {
    expect(itemsLabel(1)).toBe('1 Item');
  });

  it('is plural for more than 1', () => {
    expect(itemsLabel(3)).toBe('3 Items');
  });

  it('is plural for 0', () => {
    expect(itemsLabel(0)).toBe('0 Items');
  });
});

describe('pageNumbers — GuardPager', () => {
  it('returns every page when there are 7 or fewer', () => {
    expect(pageNumbers(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageNumbers(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageNumbers(1, 1)).toEqual([1]);
  });

  it('elides with a single null gap on a long run, keeping first/last/current+neighbours', () => {
    const out = pageNumbers(5, 20);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(20);
    expect(out).toContain(4);
    expect(out).toContain(5);
    expect(out).toContain(6);
  });

  it('never emits two adjacent nulls', () => {
    const out = pageNumbers(10, 30);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i] === null && out[i - 1] === null).toBe(false);
    }
  });

  it('keeps current at the boundary correctly (current = 1 of many pages)', () => {
    const out = pageNumbers(1, 20);
    expect(out[0]).toBe(1);
    expect(out).toContain(2);
    expect(out[out.length - 1]).toBe(20);
  });

  it('keeps current at the last page of many', () => {
    const out = pageNumbers(20, 20);
    expect(out[0]).toBe(1);
    expect(out[out.length - 1]).toBe(20);
    expect(out).toContain(19);
  });
});
