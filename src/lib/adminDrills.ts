// The admin dashboard's KPI drills — mirrors src/lib/hodDrills.ts (same DrillDef
// shape, same invariant: a KPI's number is `rows.length` of the very list its
// click opens).
//
// `AdminDashboard` scopes `allRows` to the selected period BEFORE these
// predicates run; the predicates below just filter whatever array they're
// given.
import type { GatePassView } from '../types';
import type { DrillDef } from './hodDrills';

export type AdminDrillKey = 'total' | 'awaiting' | 'returned' | 'overdue';

/** A pass with one line still out is still an open obligation. Exact lookup,
 *  never `.includes()` on the enum. */
export const IS_OPEN_RETURN: Record<GatePassView['return_status'], boolean> = {
  not_applicable: false,
  awaiting_return: true,
  partially_returned: true,
  returned: false,
};

export const ADMIN_DRILLS: Record<AdminDrillKey, DrillDef<AdminDrillKey>> = {
  total: {
    key: 'total',
    label: 'Total',
    tone: 'neutral',
    heading: 'All passes raised',
    empty: 'No passes raised in this period.',
    match: () => true,
  },
  awaiting: {
    key: 'awaiting',
    label: 'Awaiting Return',
    tone: 'brand',
    heading: 'Still out',
    empty: 'Nothing is still out in this period.',
    match: (p) => IS_OPEN_RETURN[p.return_status],
  },
  // The card shows a percentage; this drill lists the NUMERATOR behind it —
  // the fully-returned passes the rate was computed over.
  returned: {
    key: 'returned',
    label: 'Return Rate',
    tone: 'matched',
    heading: 'Returned in this period',
    empty: 'No returnable pass has been fully returned in this period.',
    match: (p) => p.return_status === 'returned',
  },
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    tone: 'overdue',
    heading: 'Past their return date',
    empty: 'Nothing is overdue.',
    match: (p) => IS_OPEN_RETURN[p.return_status] && p.is_overdue,
  },
};

/** Same order as the KPI grid. */
export const ADMIN_DRILL_ORDER: AdminDrillKey[] = ['total', 'awaiting', 'returned', 'overdue'];