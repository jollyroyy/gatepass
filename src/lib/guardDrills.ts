// The guard dashboard's drills, defined once.
//
// MOST OF THE GUARD DASHBOARD IS SCOPED TO TODAY and resets at local
// midnight — it is a shift board, not a backlog. Two day axes, because "today"
// means different things for a pass and for a gate action:
//
//   raisedToday   — the pass was RAISED today (created_at). Used by the two
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
// NEITHER OF THE TWO IS AN IN-PLACE DRILL ANY MORE (client, 2026-08-18).
// Both KPI cards NAVIGATE — Awaiting Return to `/returns`, Overdue to
// `/overdue` — because the same two lists are what the HOD's and the admin's
// boards open too, and one screen per figure is what keeps the three roles
// showing the same thing at different scopes. See DRILL_LINKS below.
//
// WHAT THIS LEAVES OUT, KNOWINGLY: material due later than today, and a legacy
// row with no expected date at all, appear in NEITHER figure. Recording their
// return has to wait until the day they come due, when they land on
// `/returns`. That is the accepted cost of the two-figure split; widening it
// means widening `awaiting`, not adding a third card.
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

export type DrillKey =
  | 'rgpRaised' | 'nrgpOut'
  | 'pending' | 'flagged'
  | 'awaiting' | 'overdue' | 'closed';

/** Which row set a drill filters: the two day-scoped sets, the
 *  never-date-filtered set of open returns, or the live gate queue.
 *
 *  `gateQueue` is the list that used to sit on the Search Pass screen and moved
 *  here when that page became search-only (2026-08-18). It is NOT day-scoped
 *  and must not be: a pass an HOD override-approved is waiting on exactly one
 *  action — the gate — whatever day it was raised, and hiding it strands a
 *  truck that has already been cleared by its department head. `openObligations` stays unfiltered
 *  even though Awaiting Return is now day-scoped — Overdue reads the same array
 *  and needs every age in it. */
export type DrillSource = 'raisedToday' | 'verifiedToday' | 'openObligations' | 'gateQueue';

export interface DrillDef {
  key: DrillKey;
  label: string;
  tone: Tone;
  /** Heading above the revealed cards. */
  heading: string;
  /** Shown instead of cards when the drill is empty. */
  empty: string;
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
  // ONE RGP FIGURE, BOTH DIRECTIONS (client, 2026-08-18). Out and In were two
  // cards for a distinction the gate does not act on differently — and In is
  // unraisable today anyway (RaisePass hardcodes `p_direction: 'out'`), so one
  // of the two counters was permanently zero. Matching on `type` alone, not on
  // categoryKey, is what keeps a future RGP-in inside the figure.
  rgpRaised: {
    key: 'rgpRaised',
    label: 'RGP Raised',
    tone: 'brand',
    heading: 'RGP raised today',
    empty: 'No returnable material has been raised today.',
    source: 'raisedToday',
    allTime: false,
    match: (p) => p.type === 'RGP',
  },
  nrgpOut: {
    key: 'nrgpOut',
    label: 'NRGP',
    tone: 'neutral',
    heading: 'NRGP raised today',
    empty: 'No non-returnable material has gone out today.',
    source: 'raisedToday',
    allTime: false,
    match: (p) => categoryKey(p.type, p.direction) === 'NRGP-out',
  },
  // THE GATE QUEUE ITSELF, moved here from Search Pass (2026-08-18). Its source
  // is already filtered to live passes (`expires_at >= now`) by the query, so
  // this predicate only has to name the two states the gate can still act on.
  //
  // 'hod_reviewed' rides along with 'pending' and that is load-bearing: an
  // HOD-approved pass is waiting on the gate alone, and for two months every
  // guard surface refused to show one. `tests/unit/hodReviewGateFlow.test.tsx`
  // pins it here now that this is the only list a guard picks from.
  pending: {
    key: 'pending',
    label: 'Pending for Gate Approval',
    tone: 'pending',
    heading: 'Waiting at the gate',
    empty: 'Queue clear — nothing is waiting at the gate.',
    source: 'gateQueue',
    allTime: true,
    match: (p) => p.status === 'pending' || p.status === 'hod_reviewed',
  },
  flagged: {
    key: 'flagged',
    label: 'Mismatch at Gate',
    tone: 'flagged',
    heading: 'Mismatched today',
    empty: 'No mismatches recorded today.',
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
    source: 'verifiedToday',
    allTime: false,
    match: (p) => p.return_status === 'returned',
  },
};

/** Movement counters first — what physically crossed the gate today — then the
 *  status of that work, then what is still open. */
export const DRILL_ORDER: DrillKey[] = [
  'rgpRaised', 'nrgpOut',
  'pending', 'flagged',
  'awaiting', 'overdue', 'closed',
];

/**
 * The two figures that open a PAGE instead of a card list.
 *
 * A guard, an HOD and an admin all read the same two lists — what is due back
 * today and what is late — so they live on their own routes rather than as an
 * in-place drill on one board (client, 2026-08-18). Scope is decided by the
 * page from the reader's role; this map only says where to go.
 */
export const DRILL_LINKS: Partial<Record<DrillKey, string>> = {
  awaiting: '/returns',
  overdue: '/overdue',
};
