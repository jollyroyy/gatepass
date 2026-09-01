// WHICH LETTER THIS PASS'S CURRENT STATE CALLS FOR. One function, one switch,
// and it is the only place that answers the question.
//
// ═══ THE EVENT IS DERIVED, NEVER TOLD ═══
//
// The browser sends a pass id and NOTHING ELSE. Everything below is read off
// the pass's own row and its own `pass_approvals` rows, so a caller cannot make
// this system tell the CEO that a pass cleared a level it did not clear, or
// tell an HOD their material left a gate it is still standing at.
//
//   "just raised"  = the pass is pending and no rung has been decided
//   "rejected"     = a rung carries `rejected`
//   "cleared"      = `status = 'matched'`
//   "stopped"      = `status = 'flagged'` (terminal since 070)
//
// Those are states, not words in a payload, and that is the whole security
// argument for this endpoint being callable by a signed-in user at all.
//
// ═══ ONE INVOCATION CAN SEND TWO LETTERS ═══
//
// Raising is the case: the requester's receipt and the first office's request
// go out together, to different people, saying different things. Everything
// else sends one. The function loops over whatever comes back, so a third kind
// needs no change there.
import type { NoticeApproval, NoticeMessage, NoticePass } from './noticeTypes.ts';
import { awaitingNotices, buildApprovalNotices } from './noticeApproval.ts';
import { raisedNotices, rejectedNotices } from './noticeLifecycle.ts';
import { gateClearedNotices, gateFlaggedNotices } from './noticeGate.ts';
import { rejectedApproval } from './noticeLadder.ts';

/** Has any office decided anything yet? EVERY row still `pending`, and nothing
 *  weaker: 063's `not_required` is stamped with a `decided_at` and is written
 *  only when the sibling office SIGNS, so a pass carrying one has been decided
 *  and is not freshly raised. Counting it as undecided would send the raiser a
 *  second "your pass was raised" letter half way up the ladder. */
function nothingDecidedYet(approvals: NoticeApproval[]): boolean {
  return approvals.every((a) => a.status === 'pending');
}

/**
 * Every letter this pass's state calls for, in the order they should be sent.
 * An empty array is a correct and common answer — a pass mid-ladder whose next
 * office has no address on file, for instance. Nothing here ever invents a
 * recipient or a claim.
 */
export function buildNotices(
  pass: NoticePass,
  approvals: NoticeApproval[],
  baseUrl: string
): NoticeMessage[] {
  // THE GATE HAS THE LAST WORD, so it is tested first. Both of these states are
  // reached only after the ladder finished (or was released past), and a pass
  // the gate has decided owes nobody an approval — checking the ladder first
  // would ask an office to sign a pass that has already left.
  if (pass.status === 'matched') return gateClearedNotices(pass, approvals, baseUrl);
  if (pass.status === 'flagged') return gateFlaggedNotices(pass, approvals, baseUrl);

  // A rejection is terminal (046): the pass is cancelled and the rungs below it
  // stay `pending` because nobody signed them. Asking one of them to approve a
  // closed pass is the exact mail this ordering exists to prevent.
  if (rejectedApproval(approvals)) return rejectedNotices(pass, approvals, baseUrl);

  // NOTHING DECIDED = THE PASS WAS JUST RAISED. Two letters: the requester's
  // receipt, then the first office's request. A pass with NO ladder at all
  // still gets the receipt — it says the pass went straight to the gate, which
  // is true and is not something the raiser can otherwise tell.
  if (nothingDecidedYet(approvals)) {
    return [
      ...raisedNotices(pass, approvals, baseUrl),
      ...awaitingNotices(pass, approvals, baseUrl),
    ];
  }

  // Mid-ladder: ask the office whose turn it is, or send the receipt once the
  // last rung is signed. Both are the ladder's own business, so both come from
  // the one function that answers for it.
  return buildApprovalNotices(pass, approvals, baseUrl);
}
