// ONE badge per pass card, and it names where the pass is NOW.
//
// Client feedback, 2026-08-11 (second round): "Only show what is the latest
// status. Maybe it is matched but it has gone out, so you don't have to show
// the match in the main card section. Do show it when people look at more
// details, in that timeline. If the passes are closed, completely returned,
// just put it Closed — don't show Matched, Returned."
//
// The first round (src/lib/rgpLifecycle.ts) added a SECOND pill beside the
// status badge, which fixed the real defect — "matched" alone cannot tell a
// pass standing outside the mall from one that closed weeks ago — but left
// every RGP card reading two facts at once: "Matched  Closed". This collapses
// them into the later of the two. Nothing is lost: the outward clearance
// becomes a moment in `passTimeline`, which is what the expanded card and the
// detail page render.
//
// Precedence, most-recent-event first:
//
//   1. Expired      — a pending pass whose day ran out. It cannot be used, and
//                     that is the last thing that happened to it.
//   2. Attention    — flagged / held / cancelled. These OUTRANK the return
//                     loop deliberately. Today the combination is unreachable
//                     (`flag_pass` admits only pending/held/hod_reviewed, so
//                     nothing sets `flagged` on a pass already cleared out),
//                     but the client asked for the return leg to be flaggable
//                     too — "while going out it might get matched but while
//                     coming back it is not matched, then that also should get
//                     flagged" — and when that lands, a pass stopped on the way
//                     back in must read "Rejected at Security Gate", not "Out — Not Returned".
//                     Getting the order right now means that feature changes
//                     the database and the gate screen, not every card.
//   3. RGP stage    — the return loop, once the gate has cleared the pass
//                     outward. `return_status` is pinned to 'not_applicable'
//                     for every NRGP and for anything still at the gate, so
//                     this arm simply does not fire for them.
//   4. Closed       — `matched` with no return loop is an NRGP through the
//                     gate: finished. It reads "Closed", never "Matched".
//   5. Awaiting     — a `pending` pass that has NOT finished climbing the
//      approval       approval ladder. It reads "Pending Approval", never
//                     "Pending Gate Review" (client, 2026-08-20: "the passes
//                     which are pending for approval are showing as pending
//                     gate approvals … after all the approvals, if it is only
//                     waiting for the gate approval, then only show the pending
//                     for gate approval, across all the views"). The guard
//                     cannot even SEE such a pass — 046 made that RLS — so
//                     calling it "pending gate review" named a desk that had
//                     nothing in front of it.
//   6. status       — everything else: pending at the gate, hod_reviewed.
import type { GatePassView, PassStatus } from '../types';
import type { StatusStyle } from './statusStyles';
import { AWAITING_APPROVAL_STYLE, EXPIRED_STYLE, STATUS_STYLES, isExpiredPending } from './statusStyles';
import { RGP_STAGE_STYLES, rgpStageStyle } from './rgpLifecycle';

/** States that demand a decision, and so must never be hidden behind the
 *  routine return loop. A `Record<PassStatus, boolean>` rather than an array
 *  `includes()`, per the repo's no-fuzzy-enum-matching rule: adding a label to
 *  `gatepass.pass_status` breaks the build here until someone has decided
 *  whether it outranks the loop. */
const OUTRANKS_RETURN_LOOP: Record<PassStatus, boolean> = {
  pending: false,
  held: true,
  matched: false,
  flagged: true,
  hod_reviewed: false,
  cancelled: true,
};

/** The pass's latest state, as the one badge every card surface renders. */
export function passStageStyle(
  p: Pick<GatePassView, 'status' | 'return_status' | 'is_expired' | 'is_overdue' | 'awaits_approval'>,
): StatusStyle {
  if (isExpiredPending(p)) return EXPIRED_STYLE;
  if (OUTRANKS_RETURN_LOOP[p.status]) return STATUS_STYLES[p.status];
  const stage = rgpStageStyle(p);
  if (stage) return stage;
  // `matched` with no return loop at all is an NRGP through the gate, and that
  // is the END of it — the material is not coming back. Client, 2026-08-18: no
  // surface says "Matched"; it names the outward clearance, which is a moment in
  // the timeline, not a state anybody is waiting on.
  if (p.status === 'matched') return RGP_STAGE_STYLES.closed;
  // The ladder outranks the gate, and only for a `pending` pass: `hod_reviewed`
  // is the HOD overriding a flag the gate itself raised, which cannot have
  // happened to a pass the gate was never allowed to see. A MISSING
  // `awaits_approval` is read as owing nothing — a pass raised before the
  // workflow existed, and the same safe reading `pendingSplit` takes.
  if (p.status === 'pending' && p.awaits_approval === true) return AWAITING_APPROVAL_STYLE;
  return STATUS_STYLES[p.status];
}
