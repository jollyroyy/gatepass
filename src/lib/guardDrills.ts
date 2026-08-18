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
// AWAITING RETURN AND OVERDUE ARE THE RETURN TIMELINE, CUT IN TWO AT TODAY
// (client, 2026-08-18) — and neither is scoped by the day the pass was RAISED:
//
//   Awaiting Return — expected back TODAY. What a guard should be watching the
//                     barrier for on this shift.
//   Overdue         — expected back on ANY EARLIER DAY and still not back. All
//                     time, every missed day, however old.
//
// Both read the view's `due_state`, so the two are disjoint by construction and
// each pass lands in exactly one. Awaiting Return used to be every open
// obligation regardless of date, which counted an overdue pass twice and put
// material due next month under a card implying somebody was expecting it now.
//
// LATENESS IS STILL NOT DECIDED HERE. `due_state` is computed in
// `gatepass.v_gate_passes` against `site_tz()` (Asia/Kolkata); comparing
// `expected_return_date` to the browser clock would make the guard's screen
// disagree with the database for every pass after 18:30 IST.
//
// `due_state` rather than `is_overdue` on purpose: the view pins `is_overdue` to
// `awaiting_return` alone, so a pass with one line back and two still outside
// read as not-overdue indefinitely. `due_state` grades both open states.
//
// The source is still `openObligations` — an unfiltered read of every open
// return — because Overdue needs passes of any age and the predicates, not the
// query, do the cutting. Only Overdue is marked `allTime` now.
//
// WHAT THIS LEAVES OUT, KNOWINGLY: material due later than today, and a legacy
// row with no expected date at all, appear in NEITHER drill. They are not lost
// and `mark_returned` is not stranded — Pending Returns (`/returns`) lists every
// open return of any date as the same returnable card. That tab is what makes
// this narrowing safe; do not delete it without widening this back.
//
// THERE IS DELIBERATELY NO "SUCCESSFUL GATE PASSES" (matched) DRILL — removed
// at the client's request, 2026-08-11. A cleared pass is finished work, and
// this board is what still needs a guard's attention; the counter grew every
// time the gate did its job correctly, so the one number that only ever went
// up was the one nobody had to act on. Two things make the removal safe rather
// than a loss of visibility:
//
//   * Reports (/all-passes) still holds every matched pass, of any date — that
//     is where the register lives, and always was.
//   * A RETURNABLE pass that came back is still on this board under
//     `closed` ("Returned & Closed"), which is a genuine end state. What is
//     gone is only the outward-clearance bucket.
//
// The NRGP consequence is worth knowing before anyone "restores" this: an NRGP
// never comes back, so once the gate matches one it now appears in no drill on
// this board at all. That is intended — it is done — but it means the guard's
// board no longer shows a same-shift count of everything cleared. If that is
// ever missed, the fix is a Today/All-time toggle in Reports, not this card.
//
// THERE IS ALSO NO "HOD APPROVED" (hod_reviewed) DRILL — removed the same day,
// same request. This one deserves a closer look before anyone reinstates it,
// because the drill was originally added to close a real hole: for two months
// an HOD's override moved a pass flagged→hod_reviewed and EVERY guard surface
// then refused to act on it — the queue filtered `pending` only and Verify hid
// the Match button — so a truck the HOD had approved could not be cleared.
//
// That hole is now closed at its source, which is why the card is redundant
// rather than load-bearing: GateConsole's queue selects
// `.in('status', ['pending','hod_reviewed'])` (035), so an approved pass sits
// in the queue a guard actually works from, and Verify offers both Match and
// Flag for it. `tests/unit/hodReviewGateFlow.test.tsx` pins both of those, and
// now also pins the absence of this drill — so if someone ever narrows the
// queue back to `pending` alone, that spec fails rather than silently
// recreating the original bug with no card left to reveal it.
import type { GatePassView } from '../types';
import type { Tone } from '../components/KpiCard';
import { categoryKey } from './passTypes';
import { isExpiredPending } from './statusStyles';

export type DrillKey =
  | 'rgpOut' | 'rgpIn' | 'nrgpOut'
  | 'pending' | 'expired' | 'flagged'
  | 'awaiting' | 'overdue' | 'closed';

/** Which row set a drill filters: the two day-scoped sets, or the
 *  never-date-filtered set of open returns. `openObligations` stays unfiltered
 *  even though Awaiting Return is now day-scoped — Overdue reads the same array
 *  and needs every age in it. */
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
  /** True only for Overdue, the one drill that reaches back past today. The
   *  card prints "all time" so a reader is not left guessing which figures
   *  reset at midnight. */
  allTime: boolean;
  match: (p: GatePassView) => boolean;
}

/** Still owes material — the pass went out and has not fully come back.
 *  `partially_returned` counts: one line back out of three is not closure, and
 *  omitting it once made a part-returned pass unreachable from the drill that
 *  records the rest (see GuardDashboard's openObligations query). */
const isAwaiting = (p: GatePassView): boolean =>
  p.return_status === 'awaiting_return' || p.return_status === 'partially_returned';

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
  awaiting: {
    key: 'awaiting',
    label: 'Awaiting Return',
    tone: 'brand',
    // TODAY'S expected returns only — see the module comment. A pass due next
    // week is not something anyone is waiting at the barrier for.
    heading: 'Expected back today',
    empty: 'Nothing is expected back today.',
    returnable: true,
    source: 'openObligations',
    allTime: false,
    match: (p) => isAwaiting(p) && p.due_state === 'due_today',
  },
  overdue: {
    key: 'overdue',
    label: 'Overdue',
    tone: 'overdue',
    // Every day that was missed, however long ago — see the module comment.
    heading: 'Past its return date (all time)',
    empty: 'Nothing is overdue.',
    returnable: true,
    source: 'openObligations',
    allTime: true,
    match: (p) => isAwaiting(p) && p.due_state === 'overdue',
  },
  // The far end of the RGP loop. Client complaint, 2026-08-11: a returnable
  // pass cleared OUTWARD reads as "Matched" and looks finished, when half its
  // journey has not happened. `matched` therefore cannot mean "done" — this
  // drill is the only bucket on the guard's board that does.
  //
  // Sourced from `verifiedToday`, not `openObligations`: a closed pass is by
  // definition no longer an open obligation, and this is a shift board — what
  // the gate finished TODAY. The all-time archive of closed passes belongs in
  // Reports, not on a board a guard reads standing at a barrier.
  closed: {
    key: 'closed',
    label: 'Returned & Closed',
    tone: 'matched',
    heading: 'Came back and closed today',
    empty: 'Nothing has been closed today.',
    returnable: false,
    source: 'verifiedToday',
    allTime: false,
    match: (p) => p.return_status === 'returned',
  },
};

/** Movement counters first — what physically crossed the gate today — then the
 *  status of that work, then what is still open. */
export const DRILL_ORDER: DrillKey[] = [
  'rgpOut', 'rgpIn', 'nrgpOut',
  'pending', 'expired', 'flagged',
  'awaiting', 'overdue', 'closed',
];

