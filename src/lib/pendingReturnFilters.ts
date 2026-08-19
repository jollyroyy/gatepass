// The Pending RGP Return page's derivations — the status tabs, the three scope
// selects, the sort and the tab counts (client mock-up, 2026-08-19).
//
// Same shape and the same rule as `pendingOutFilters.ts`: it is ALL client-side
// over the one array the page already loaded, so the tab counts, the filter
// options and the rows in the table are three readings of a single fetch. A
// count on this screen can never disagree with the list under it.
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
export type ReturnTab = 'all' | 'dueToday' | 'overdue' | 'partial';

export const RETURN_TABS: ReturnTab[] = ['all', 'dueToday', 'overdue', 'partial'];

export const RETURN_TAB_LABELS: Record<ReturnTab, string> = {
  all: 'All',
  dueToday: 'Due Today',
  overdue: 'Overdue',
  partial: 'Returned Partially',
};

/** True of a row when the tab is selected.
 *
 *  `dueToday` and `overdue` are disjoint (`due_state` is one value), but
 *  `partial` deliberately CUTS ACROSS both — a partly-returned pass is also
 *  either due today or late, and it belongs under both readings. So the counts
 *  do not sum to All, and that is honest: they are four questions, not four
 *  buckets. */
const TAB_MATCH: Record<ReturnTab, (p: GatePassView) => boolean> = {
  all: () => true,
  dueToday: (p) => p.due_state === 'due_today',
  overdue: (p) => p.due_state === 'overdue',
  partial: (p) => p.return_status === 'partially_returned',
};

/** Oldest expected date first is the default and the gate's own order — what
 *  is most overdue is what a guard should read first. */
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
  const counts: Record<ReturnTab, number> = { all: 0, dueToday: 0, overdue: 0, partial: 0 };
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
