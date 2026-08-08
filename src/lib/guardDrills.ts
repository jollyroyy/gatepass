// The guard dashboard's drills, defined once.
//
// MOST OF THE GUARD DASHBOARD IS SCOPED TO TODAY and resets at local
// midnight — it is a shift board, not a backlog. Two day axes, because "today"
// means different things for a pass and for a gate action:
//
//   raisedToday   — the pass was RAISED today (created_at). Used by the three
//                   movement counters and by the pending queue.
//   verifiedToday — the GUARD acted today (verified_at). Used by Matched and
//                   Mismatch, which describe this shift's work, not the pass's age.
//
// AWAITING RETURN AND OVERDUE ARE THE DELIBERATE EXCEPTION — they are NOT
// today-scoped, and that is a considered decision, not an oversight:
//
//   Pending / Matched / Mismatch describe an EVENT that happened today (a
//   pass was raised, or the guard verified it), so "today only" is simply
//   correct for them. Awaiting Return and Overdue describe an ONGOING
//   OBLIGATION — material that is still outside the gate — which does not
//   stop being true just because the calendar rolled over. An RGP raised
//   last week whose material never came back is *more* urgent today than
//   one raised an hour ago, not less, and it must not silently vanish from
//   the board at midnight. Worse, `mark_returned` is reachable ONLY from
//   the Awaiting Return drill card (GuardDrillCard) — today-scoping it would
//   make a pass raised on an earlier day permanently unreturnable through
//   the UI. So these two use the `openObligations` source: every pass
//   currently `awaiting_return`, full stop, no date filter. They are marked
//   `allTime: true` so the card visibly says so instead of looking like an
//   inconsistency nobody noticed.
import type { GatePassView } from '../types';
import type { Tone } from '../components/KpiCard';
import { categoryKey } from './passTypes';
import { isExpiredPending } from './statusStyles';

export type DrillKey =
  | 'rgpOut' | 'rgpIn' | 'nrgpOut'
  | 'pending' | 'expired' | 'matched' | 'flagged' | 'approved'
  | 'awaiting' | 'overdue';

/** Which row set a drill filters: the two day-scoped sets, or the
 *  never-date-filtered set of open (still awaiting_return) passes. */
export type DrillSource = 'raisedToday' | 'verifiedToday' | 'openObligations';

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
  /** True for the two drills that are intentionally NOT today-scoped. */
  allTime: boolean;
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
    allTime: false,
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
    allTime: false,
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
    allTime: false,
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
    allTime: false,
    match: (p) => p.status === 'pending',
  },
  // Same today-scoping as `pending` — this is about today's gate activity:
  // passes raised today whose paperwork went stale before anyone showed up.
  // Not a status enum value; `is_expired` is derived by the database and only
  // means anything while the pass is still pending (see isExpiredPending).
  // Red (flagged tone) — this demands the same attention as a mismatch.
  expired: {
    key: 'expired',
    label: 'Expired',
    tone: 'flagged',
    heading: 'Expired without reaching the gate',
    empty: 'Nothing has expired today.',
    returnable: false,
    source: 'raisedToday',
    allTime: false,
    match: isExpiredPending,
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
    allTime: false,
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
    allTime: false,
    match: (p) => p.status === 'flagged',
  },
  // The two months of flag-flow history nearly ended here: the HOD's
  // approval moved a pass flagged→hod_reviewed, and every guard surface then
  // refused to act on it (queue filtered 'pending' only, Verify hid Match).
  // The truck had been approved through but could not be cleared. This drill
  // is what makes the mopped-up end of that chain visible again: a pass
  // approved by the HOD is waiting on exactly one action — the gate.
  approved: {
    key: 'approved',
    label: 'HOD Approved',
    tone: 'accent',
    heading: 'Approved by the HOD, waiting to clear',
    empty: 'No HOD-approved passes at the gate right now.',
    returnable: false,
    source: 'raisedToday',
    allTime: false,
    match: (p) => p.status === 'hod_reviewed',
  },
  awaiting: {
    key: 'awaiting',
    label: 'Awaiting Return',
    tone: 'brand',
    // Deliberately NOT today-scoped — see the module comment. An obligation
    // that started last week is still open today.
    heading: 'Still out (all time)',
    empty: 'Nothing is currently out.',
    returnable: true,
    source: 'openObligations',
    allTime: true,
    match: isAwaiting,
  },
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    tone: 'overdue',
    // Deliberately NOT today-scoped — see the module comment.
    heading: 'Past its return date (all time)',
    empty: 'Nothing is overdue.',
    returnable: true,
    source: 'openObligations',
    allTime: true,
    match: (p) => isAwaiting(p) && p.is_overdue,
  },
};

/** Movement counters first — what physically crossed the gate today — then the
 *  status of that work, then what is still open. */
export const DRILL_ORDER: DrillKey[] = [
  'rgpOut', 'rgpIn', 'nrgpOut',
  'pending', 'expired', 'matched', 'flagged', 'approved',
  'awaiting', 'overdue',
];

