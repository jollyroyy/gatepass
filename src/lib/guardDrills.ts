// The guard dashboard's drills, defined once.
//
// EVERYTHING ON THE GUARD DASHBOARD IS SCOPED TO TODAY and resets at local
// midnight — it is a shift board, not a backlog. Two day axes, because "today"
// means different things for a pass and for a gate action:
//
//   raisedToday   — the pass was RAISED today (created_at). Used by the three
//                   movement counters and by the pending queue.
//   verifiedToday — the GUARD acted today (verified_at). Used by Matched and
//                   Mismatch, which describe this shift's work, not the pass's age.
//
// Each drill is a KPI card AND the predicate behind the cards it reveals, so the
// number on the card is `rows.length` of the very list the click opens. Two
// separate queries — one counting, one listing — is exactly how a dashboard ends
// up saying "4 awaiting return" above three cards.
import type { GatePassView } from '../types';
import type { Tone } from '../components/KpiCard';
import { categoryKey } from './passTypes';

export type DrillKey =
  | 'rgpOut' | 'rgpIn' | 'nrgpOut'
  | 'pending' | 'matched' | 'flagged'
  | 'awaiting' | 'overdue';

/** Which of the two day-scoped row sets a drill filters. */
export type DrillSource = 'raisedToday' | 'verifiedToday';

export interface DrillDef {
  key: DrillKey;
  label: string;
  tone: Tone;
  /** Heading above the revealed cards. */
  heading: string;
  /** Shown instead of cards when the drill is empty. */
  empty: string;
  /** Only material that has actually left the gate can be marked returned. */
  returnable: boolean;
  source: DrillSource;
  match: (p: GatePassView) => boolean;
}

const isAwaiting = (p: GatePassView): boolean => p.return_status === 'awaiting_return';

export const DRILL_DEFS: Record<DrillKey, DrillDef> = {
  rgpOut: {
    key: 'rgpOut',
    label: 'RGP Out',
    tone: 'brand',
    heading: 'RGP Out raised today',
    empty: 'No returnable material has gone out today.',
    returnable: false,
    source: 'raisedToday',
    match: (p) => categoryKey(p.type, p.direction) === 'RGP-out',
  },
  rgpIn: {
    key: 'rgpIn',
    label: 'RGP In',
    tone: 'accent',
    heading: 'RGP In raised today',
    empty: 'No inbound returnable material today.',
    returnable: false,
    source: 'raisedToday',
    match: (p) => categoryKey(p.type, p.direction) === 'RGP-in',
  },
  nrgpOut: {
    key: 'nrgpOut',
    label: 'NRGP Out',
    tone: 'neutral',
    heading: 'NRGP Out raised today',
    empty: 'No non-returnable material has gone out today.',
    returnable: false,
    source: 'raisedToday',
    match: (p) => categoryKey(p.type, p.direction) === 'NRGP-out',
  },
  pending: {
    key: 'pending',
    label: 'Pending for Gate Approval',
    tone: 'pending',
    heading: 'Waiting at the gate',
    empty: 'Queue clear — nothing raised today is waiting.',
    returnable: false,
    source: 'raisedToday',
    match: (p) => p.status === 'pending',
  },
  matched: {
    key: 'matched',
    label: 'Successful Gate Passes',
    tone: 'matched',
    // Every pass the gate cleared today, whatever its type or direction —
    // RGP Out, RGP In and NRGP Out all count. `matched` IS "successful": it is
    // the status match_pass sets, and the only way material legitimately moves.
    heading: 'Cleared through the gate today',
    empty: 'No gate pass has been cleared today.',
    returnable: false,
    source: 'verifiedToday',
    match: (p) => p.status === 'matched',
  },
  flagged: {
    key: 'flagged',
    label: 'Mismatch at Gate',
    tone: 'flagged',
    heading: 'Mismatched today',
    empty: 'No mismatches recorded today.',
    returnable: false,
    source: 'verifiedToday',
    match: (p) => p.status === 'flagged',
  },
  awaiting: {
    key: 'awaiting',
    label: 'Awaiting Return',
    tone: 'brand',
    heading: 'Raised today, still out',
    empty: 'Nothing raised today is still out.',
    returnable: true,
    source: 'raisedToday',
    match: isAwaiting,
  },
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    tone: 'overdue',
    heading: 'Raised today and already past its return date',
    empty: 'Nothing raised today is overdue.',
    returnable: true,
    source: 'raisedToday',
    match: (p) => isAwaiting(p) && p.is_overdue,
  },
};

/** Movement counters first — what physically crossed the gate today — then the
 *  status of that work, then what is still open. */
export const DRILL_ORDER: DrillKey[] = [
  'rgpOut', 'rgpIn', 'nrgpOut',
  'pending', 'matched', 'flagged',
  'awaiting', 'overdue',
];

/** Local midnight, so the board resets with the calendar day the guard is in —
 *  not with UTC, which rolls over at 05:30 IST in the middle of a night shift. */
export function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
