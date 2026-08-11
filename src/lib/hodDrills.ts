// The HOD dashboard's KPI drills, defined once — mirrors src/lib/guardDrills.ts.
//
// The dashboard unconditionally scopes `allRows` to today (see `todayBounds`
// in src/lib/hodKpis.ts) BEFORE these predicates ever run — see
// src/pages/HOD/Dashboard.tsx. The predicates below don't know or care about
// that scoping; they just filter whatever array they're given.
//
// Each drill is a KPI card AND the predicate behind the cards it reveals, so
// the number on the card is always `rows.length` of the very list the click
// opens — one fetch, filtered eight ways, never a second aggregate query that
// could disagree with the list.
import type { GatePassView } from '../types';
import type { Tone } from '../components/KpiCard';
import { isExpiredPending } from './statusStyles';

export type DrillKey =
  | 'total' | 'rgpIssued' | 'nrgpIssued' | 'pending' | 'expired' | 'matched' | 'flagged'
  | 'closed' | 'awaiting' | 'overdue';

export interface DrillDef<K extends string = DrillKey> {
  key: K;
  label: string;
  tone: Tone;
  /** Heading above the revealed list. */
  heading: string;
  /** Shown instead of a list when the drill is empty. */
  empty: string;
  match: (p: GatePassView) => boolean;
}

/** `awaitingReturn` also counts `partially_returned` — a pass with one line
 *  still out is still an open obligation, per `kpis()`'s own definition. */
const isAwaiting = (p: GatePassView): boolean =>
  p.return_status === 'awaiting_return' || p.return_status === 'partially_returned';

export const DRILL_DEFS: Record<DrillKey, DrillDef> = {
  total: {
    key: 'total',
    label: 'Total Raised',
    tone: 'neutral',
    heading: 'All passes raised',
    empty: 'No passes raised yet.',
    match: () => true,
  },
  rgpIssued: {
    key: 'rgpIssued',
    label: 'RGP Issued',
    tone: 'accent',
    heading: 'RGP passes raised',
    empty: 'No RGP passes raised.',
    match: (p) => p.type === 'RGP',
  },
  nrgpIssued: {
    key: 'nrgpIssued',
    label: 'NRGP Issued',
    tone: 'brand',
    heading: 'NRGP passes raised',
    empty: 'No NRGP passes raised.',
    match: (p) => p.type === 'NRGP',
  },
  pending: {
    key: 'pending',
    label: 'Pending Verification',
    tone: 'pending',
    heading: 'Waiting on the guard',
    empty: 'Nothing is waiting on the guard right now.',
    match: (p) => p.status === 'pending',
  },
  // Not a status enum value — `is_expired` is derived by the database on
  // `v_gate_passes` and only means anything while the pass is still pending;
  // once it reaches an outcome it is no longer "expired", it is done. Red
  // (flagged tone) because this is the HOD's signal that material they
  // authorised never moved and the paperwork is now dead — it demands
  // attention the same way a mismatch does.
  expired: {
    key: 'expired',
    label: 'Expired',
    tone: 'flagged',
    heading: 'Expired without reaching the gate',
    empty: 'Nothing has expired.',
    match: isExpiredPending,
  },
  matched: {
    key: 'matched',
    label: 'Matched',
    tone: 'matched',
    heading: 'Cleared through the gate',
    empty: 'No pass has been matched yet.',
    match: (p) => p.status === 'matched',
  },
  flagged: {
    key: 'flagged',
    label: 'Mismatched',
    tone: 'flagged',
    heading: 'Mismatched at the gate',
    empty: 'No mismatches recorded.',
    match: (p) => p.status === 'flagged',
  },
  // The other end of the RGP loop, and the NUMERATOR behind the Return Rate
  // card. An RGP has to make two trips — out, then back — and `status` stops
  // describing it after the first: a pass still outside the mall and one that
  // came back last week are both `matched`. This is the only drill that means
  // "finished".
  closed: {
    key: 'closed',
    label: 'Return Rate',
    tone: 'matched',
    heading: 'Closed — returned in full',
    empty: 'No returnable pass has been fully returned in this period.',
    match: (p) => p.return_status === 'returned',
  },
  awaiting: {
    key: 'awaiting',
    label: 'Awaiting Return',
    tone: 'brand',
    heading: 'Still out',
    empty: 'Nothing is still out.',
    match: isAwaiting,
  },
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    tone: 'overdue',
    heading: 'Past their return date',
    empty: 'Nothing is overdue.',
    match: (p) => isAwaiting(p) && p.is_overdue,
  },
};

/** Volume first, then gate outcome, then the return loop — closed, still
 *  open, past due. */
export const DRILL_ORDER: DrillKey[] = [
  'total', 'rgpIssued', 'nrgpIssued', 'pending', 'expired', 'matched', 'flagged',
  'closed', 'awaiting', 'overdue',
];

/** Return rate over an already-scoped row set: fully returned ÷ everything
 *  that entered a return cycle at all.
 *
 *  MUST be computed from the same array the KPI cards and drill lists use —
 *  never from `kpis()`, which takes no date parameter and aggregates ALL TIME.
 *  That was the 2026-08-11 bug: the card sat at a lifetime 93% while the rest
 *  of the board described today, and no amount of raising or returning passes
 *  moved it. NRGPs are excluded by construction: `return_status` is pinned to
 *  'not_applicable' for them (`gate_passes_return_status_rgp_only`, 001), so
 *  they never enter the denominator. */
export function returnRateOf(rows: GatePassView[]): number {
  const returnable = rows.filter((p) => p.return_status !== 'not_applicable');
  if (returnable.length === 0) return 0;
  const closed = returnable.filter((p) => p.return_status === 'returned').length;
  return Math.round((closed / returnable.length) * 100);
}
