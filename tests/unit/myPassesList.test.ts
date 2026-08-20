// The My Passes list's derivations (client mock-up, 2026-08-20): the three type
// tabs and their counts, the search, and the two label maps the card paints
// from.
//
// The load-bearing one is the SUM INVARIANT — All is `rows.length` and never a
// third predicate, so no pass can be missed by both type tabs or claimed by
// both.
import { describe, it, expect } from 'vitest';
import type { GatePassView } from '../../src/types';
import {
  applyMyPassTab,
  itemsLabel,
  matchesMyPassSearch,
  MY_PASS_TABS,
  MY_PASS_TAB_LABELS,
  MY_PASS_TYPE_GLYPH,
  MY_PASS_TYPE_PILL,
  MY_PASS_TYPE_PLATE,
  myPassTabCounts,
} from '../../src/lib/myPassesList';

function pass(over: Partial<GatePassView>): GatePassView {
  return {
    id: 'x', pass_number: 'RGP-20260820-0001', type: 'RGP', direction: 'out',
    status: 'pending', return_status: 'not_applicable',
    department_id: 'd1', department_name: 'Engineering', department_code: 'ENG',
    raised_by: 'u1', raised_by_name: 'HOD One',
    visitor_name: 'Ravi', visitor_company: null, vehicle_number: 'WB01AB1234',
    purpose: 'Raw Materials - Production', expected_return_date: null, actual_return_date: null,
    verified_by: null, verified_by_name: null, verified_at: null, flag_reason: null,
    qr_token: 't', expires_at: null, created_at: new Date().toISOString(),
    is_overdue: false, is_expired: false, due_state: 'none',
    item_count: 6, total_quantity: 6, returned_quantity: 0,
    material_summary: 'Drill', total_value: 25000,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('myPassTabCounts', () => {
  it('offers exactly All / RGP / NRGP, in the mock-up order', () => {
    expect(MY_PASS_TABS).toEqual(['all', 'RGP', 'NRGP']);
    expect(MY_PASS_TABS.map((k) => MY_PASS_TAB_LABELS[k])).toEqual(['All', 'RGP', 'NRGP']);
  });

  it('the two type figures add up to All, on every mix', () => {
    const rows = [
      pass({ id: 'a' }),
      pass({ id: 'b', type: 'NRGP' }),
      pass({ id: 'c' }),
      pass({ id: 'd', type: 'NRGP' }),
      pass({ id: 'e', type: 'NRGP' }),
    ];
    const counts = myPassTabCounts(rows);
    expect(counts.all).toBe(5);
    expect(counts.RGP).toBe(2);
    expect(counts.NRGP).toBe(3);
    expect(counts.RGP + counts.NRGP).toBe(counts.all);
  });

  it('an empty list counts zero everywhere rather than throwing', () => {
    expect(myPassTabCounts([])).toEqual({ all: 0, RGP: 0, NRGP: 0 });
  });

  it('a tab shows exactly the rows its own figure counted', () => {
    const rows = [pass({ id: 'a' }), pass({ id: 'b', type: 'NRGP' })];
    const counts = myPassTabCounts(rows);
    expect(applyMyPassTab(rows, 'all')).toHaveLength(counts.all);
    expect(applyMyPassTab(rows, 'RGP').map((p) => p.id)).toEqual(['a']);
    expect(applyMyPassTab(rows, 'NRGP')).toHaveLength(counts.NRGP);
  });
});

describe('matchesMyPassSearch', () => {
  const p = pass({ pass_number: 'RGP-20260820-0024', purpose: 'Raw Materials - Production' });

  it('an empty query matches everything', () => {
    expect(matchesMyPassSearch(p, '')).toBe(true);
    expect(matchesMyPassSearch(p, '   ')).toBe(true);
  });

  it('finds a pass by GP number and by purpose — what the placeholder promises', () => {
    expect(matchesMyPassSearch(p, '0024')).toBe(true);
    expect(matchesMyPassSearch(p, 'raw materials')).toBe(true);
  });

  it('still finds it by the person and the vehicle, which the page always could', () => {
    expect(matchesMyPassSearch(p, 'ravi')).toBe(true);
    expect(matchesMyPassSearch(p, 'wb01')).toBe(true);
  });

  it('says no when nothing on the pass carries the query', () => {
    expect(matchesMyPassSearch(p, 'zzz')).toBe(false);
  });
});

describe('the card paints from lookup maps, never a string test', () => {
  it('RGP is blue and NRGP purple — the mock-up pairing, in `.gb-*` classes only', () => {
    expect(MY_PASS_TYPE_PILL.RGP).toBe('gb-pill-blue');
    expect(MY_PASS_TYPE_PILL.NRGP).toBe('gb-pill-purple');
    expect(MY_PASS_TYPE_PLATE.RGP).toBe('gb-tint-blue');
    expect(MY_PASS_TYPE_PLATE.NRGP).toBe('gb-tint-purple');
    for (const v of [...Object.values(MY_PASS_TYPE_PILL), ...Object.values(MY_PASS_TYPE_PLATE)]) {
      expect(v).toMatch(/^gb-/);
    }
  });

  it('the glyph says which way the material goes', () => {
    expect(MY_PASS_TYPE_GLYPH.RGP).toBe('arrow');
    expect(MY_PASS_TYPE_GLYPH.NRGP).toBe('exit');
  });
});

describe('itemsLabel', () => {
  it('is singular for one and plural for the rest, including zero', () => {
    expect(itemsLabel(1)).toBe('1 Item');
    expect(itemsLabel(6)).toBe('6 Items');
    expect(itemsLabel(0)).toBe('0 Items');
  });
});
