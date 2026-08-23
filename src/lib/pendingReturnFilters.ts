// The Pending RGP Return page's derivations — the status tabs, the three scope
// selects, the sort and the tab counts (client mock-up, 2026-08-19).
//
// Same shape and the same rule as `pendingOutFilters.ts`: it is ALL client-side
// over the one array the page already loaded, so the tab counts, the filter
// options and the rows in the table are three readings of a single fetch. A
// count on this screen can never disagree with the list under it.
//
// "DUE TODAY" AND "OVERDUE" ARE GONE (client, 2026-08-23: a pass past its date
// "should not show it in the pending return… it should show only in the overdue
// section"). This queue is due-today material only now
// (`needsReturnVerification`), so Due Today would have been a synonym for All
// and Overdue an option that could never return a row — a control that teaches
// nothing, and one that teaches a falsehood.
//
// THE MOCK'S FIFTH TAB, "Returned", IS DELIBERATELY ABSENT. This page loads
// open returns only (`awaiting_return` / `partially_returned`); a pass whose
// last line came back has left this queue by definition, and a tab for it would
// need a second query with an invented time window ("returned when? today?
// this month?"). The pass's own record and Reports are where a closed return is
// read. "Returned Partially" is here, because a partly-returned pass is still
// standing at the barrier owing material.
//
// The mock's GATE column and `Gate:` select are DEPARTMENT here, the same
// substitution the Pending OUT page makes: there is no gate entity in this
// schema, and a column this app cannot fill is given the fact it does have.
import type { GatePassView } from '../types';
import { partyOf } from './guardBoard';

/** The tab strip, and the `Status:` select under it — ONE choice with two
 *  controls, exactly as the mock draws it. A `Record` keyed by this union is
 *  what makes a fifth tab a compile error rather than a blank table. */
export type ReturnTab = 'all' | 'partial';

export const RETURN_TABS: ReturnTab[] = ['all', 'partial'];

export const RETURN_TAB_LABELS: Record<ReturnTab, string> = {
  all: 'All',
  partial: 'Returned Partially',
};

/** True of a row when the tab is selected. `partial` is a SUBSET of `all`, not
 *  a bucket beside it — the two counts do not sum to the list, and that is
 *  honest: they are two questions about the same rows. */
const TAB_MATCH: Record<ReturnTab, (p: GatePassView) => boolean> = {
  all: () => true,
  partial: (p) => p.return_status === 'partially_returned',
};

/** Oldest expected date first is the default and the gate's own order. */
export type ReturnSortKey = 'due' | 'party';

export const RETURN_SORT_LABELS: Record<ReturnSortKey, string> = {
  due: 'Expected Back Date',
  party: 'Vendor (A–Z)',
};

export interface PendingReturnFilters {
  tab: ReturnTab;
  /** `''` means "All" on each of the two scope selects. */
  party: string;
  department: string;
  sort: ReturnSortKey;
}

export const DEFAULT_RETURN_FILTERS: PendingReturnFilters = {
  tab: 'all',
  party: '',
  department: '',
  sort: 'due',
};

/** True when anything is narrowed — what the Reset button is enabled by. */
export function isReturnFiltered(f: PendingReturnFilters): boolean {
  return f.tab !== DEFAULT_RETURN_FILTERS.tab
    || f.party !== DEFAULT_RETURN_FILTERS.party
    || f.department !== DEFAULT_RETURN_FILTERS.department
    || f.sort !== DEFAULT_RETURN_FILTERS.sort;
}

/** The count beside each tab, over the WHOLE list and never the filtered one —
 *  a tab reading "(0)" is exactly what tells a guard not to click it. */
export function returnTabCounts(rows: GatePassView[]): Record<ReturnTab, number> {
  const counts: Record<ReturnTab, number> = { all: 0, partial: 0 };
  for (const p of rows) {
    for (const tab of RETURN_TABS) if (TAB_MATCH[tab](p)) counts[tab] += 1;
  }
  return counts;
}

/** The rows the table renders. Never mutates the input — the tab counts read
 *  the same array afterwards. A dateless row sorts last rather than throwing
 *  the order; the comparator stays total. */
export function applyReturnFilters(
  rows: GatePassView[],
  f: PendingReturnFilters
): GatePassView[] {
  const out = rows.filter((p) => {
    if (!TAB_MATCH[f.tab](p)) return false;
    if (f.party && partyOf(p) !== f.party) return false;
    if (f.department && (p.department_name ?? '') !== f.department) return false;
    return true;
  });
  return out.sort((a, b) =>
    f.sort === 'party'
      ? partyOf(a).localeCompare(partyOf(b))
      : (a.expected_return_date ?? '9999-12-31').localeCompare(
        b.expected_return_date ?? '9999-12-31'
      ));
}
