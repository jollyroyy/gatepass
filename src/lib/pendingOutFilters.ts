// The Pending OUT page's derivations — the type tabs, the three scope selects,
// the sort and the pager arithmetic (client mock-up, 2026-08-19).
//
// It is ALL client-side over the one array the page already loaded, and that
// is the point: the tab counts, the filter options and the rows in the table
// are three readings of a single fetch, so a count can never disagree with the
// list under it. The board's oldest invariant, carried onto its own page.
//
// The mock-up's GATE column is DEPARTMENT here. There is no gate entity in this
// schema — a pass is raised by a department, not at a barrier number — and the
// same rule the record view follows applies: a column this app cannot fill is
// given the fact it does have, never an em dash down the whole table.
import type { GatePassView, PassType } from '../types';
import { partyOf } from './guardBoard';

/** The tabs above the table, and the `Type:` select — ONE choice with two
 *  controls, exactly as the mock-up draws it. A `Record` keyed by this union
 *  is what makes a fourth tab a compile error. */
export type TypeTab = 'all' | PassType;

export const TYPE_TABS: TypeTab[] = ['all', 'RGP', 'NRGP'];

export const TYPE_TAB_LABELS: Record<TypeTab, string> = {
  all: 'All',
  RGP: 'RGP',
  NRGP: 'NRGP',
};

/** Oldest first is the default and the gate's own order: the truck that
 *  arrived at 10:20 is served before the one at 10:30. */
export type SortKey = 'oldest' | 'newest';

export const SORT_LABELS: Record<SortKey, string> = {
  oldest: 'Oldest First',
  newest: 'Newest First',
};

export interface PendingOutFilters {
  tab: TypeTab;
  /** `''` means "All" on each of the three scope selects. */
  party: string;
  department: string;
  sort: SortKey;
}

export const DEFAULT_FILTERS: PendingOutFilters = {
  tab: 'all',
  party: '',
  department: '',
  sort: 'oldest',
};

/** True when anything is narrowed — what the Reset button is enabled by. */
export function isFiltered(f: PendingOutFilters): boolean {
  return f.tab !== DEFAULT_FILTERS.tab
    || f.party !== DEFAULT_FILTERS.party
    || f.department !== DEFAULT_FILTERS.department
    || f.sort !== DEFAULT_FILTERS.sort;
}

/** The count beside each tab, over the WHOLE list — a tab that reads (0) is
 *  what tells the reader not to click it, so these are deliberately not
 *  narrowed by the other three controls. */
export function tabCounts(rows: GatePassView[]): Record<TypeTab, number> {
  const counts: Record<TypeTab, number> = { all: rows.length, RGP: 0, NRGP: 0 };
  for (const p of rows) counts[p.type] += 1;
  return counts;
}

/** Sorted, de-duplicated option lists for the Vendor and Department selects.
 *  Built from the rows themselves, so an option that would return nothing can
 *  never be offered. */
export function scopeOptions(rows: GatePassView[]): { parties: string[]; departments: string[] } {
  const parties = new Set<string>();
  const departments = new Set<string>();
  for (const p of rows) {
    const party = partyOf(p).trim();
    if (party) parties.add(party);
    const dept = (p.department_name ?? '').trim();
    if (dept) departments.add(dept);
  }
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b));
  return { parties: sorted(parties), departments: sorted(departments) };
}

/** The rows the table renders: narrowed by all four controls, in that order.
 *  Never mutates the input — the tab counts read the same array afterwards. */
export function applyFilters(rows: GatePassView[], f: PendingOutFilters): GatePassView[] {
  const out = rows.filter((p) => {
    if (f.tab !== 'all' && p.type !== f.tab) return false;
    if (f.party && partyOf(p) !== f.party) return false;
    if (f.department && (p.department_name ?? '') !== f.department) return false;
    return true;
  });
  return out.sort((a, b) =>
    f.sort === 'oldest'
      ? a.created_at.localeCompare(b.created_at)
      : b.created_at.localeCompare(a.created_at));
}

/** The mock-up's "Rows per page" choices. 10 is its own default. */
export const ROWS_PER_PAGE = [10, 25, 50] as const;
export const DEFAULT_ROWS_PER_PAGE = 10;

/** "3 Items" / "1 Item" — the mock's Items cell, which is a count and a
 *  disclosure, not a list. */
export function itemsLabel(count: number): string {
  return `${count} ${count === 1 ? 'Item' : 'Items'}`;
}
