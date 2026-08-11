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
//                     back in must read "Mismatched", not "Out — Not Returned".
//                     Getting the order right now means that feature changes
//                     the database and the gate screen, not every card.
//   3. RGP stage    — the return loop, once the gate has cleared the pass
//                     outward. `return_status` is pinned to 'not_applicable'
//                     for every NRGP and for anything still at the gate, so
//                     this arm simply does not fire for them.
//   4. status       — everything else: pending, hod_reviewed, and an NRGP's
//                     matched (which IS its final state — it never comes back).
import type { GatePassView, PassStatus } from '../types';
import type { StatusStyle } from './statusStyles';
import { EXPIRED_STYLE, STATUS_STYLES, isExpiredPending } from './statusStyles';
import { rgpStageStyle } from './rgpLifecycle';

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
  p: Pick<GatePassView, 'status' | 'return_status' | 'is_expired' | 'is_overdue'>,
): StatusStyle {
  if (isExpiredPending(p)) return EXPIRED_STYLE;
  if (OUTRANKS_RETURN_LOOP[p.status]) return STATUS_STYLES[p.status];
  return rgpStageStyle(p) ?? STATUS_STYLES[p.status];
}
