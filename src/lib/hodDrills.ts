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
  | 'total' | 'rgpIssued' | 'nrgpIssued' | 'pending' | 'expired' | 'matched' | 'flagged' | 'awaiting' | 'overdue';

export interface DrillDef {
  key: DrillKey;
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

/** Volume first, then gate outcome, then what is still open. */
export const DRILL_ORDER: DrillKey[] = [
  'total', 'rgpIssued', 'nrgpIssued', 'pending', 'expired', 'matched', 'flagged', 'awaiting', 'overdue',
];
