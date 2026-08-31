// THE CEO IS ON THE PRINTED SLIP ONLY WHEN THE CEO IS THE ONE SIGNING IT.
//
// Client, 2026-08-31: "remove CEO from print pass page if he is not approving.
// When the COO is absent and is unable to approve, only that time show CEO
// approval in the print pass page."
//
// Level 3 is ONE rung held by TWO offices (migration 063): the COO gets first
// refusal, and the CEO inherits the rung only once `coo_escalation_hours` have
// passed without a decision. So on most passes the CEO never had anything to
// sign — and a box headed "CEO" on the paper says the opposite. It printed as
// "Not required" or as an empty awaiting box, and both read, to somebody
// holding the sheet at a gate, as a signature that is still owed.
//
// THIS IS A PRINT RULE AND NOTHING ELSE. The record on screen still draws every
// rung the pass owes, including a skipped one — a desk reader is entitled to
// see that the CEO's rung existed and was closed by the COO's signature. The
// paper has no room for a rung nobody will ever sign, and no reader who can
// click into it for the explanation.
//
// WHEN THE BOX SURVIVES, all four cases meaning "the CEO is the office in play":
//
//   * the CEO approved or rejected the pass — they signed it, so they print;
//   * the COO's window has run out and the rung is now the CEO's to sign — the
//     client's "COO is absent and unable to approve", stated as the database
//     states it (`withEscalation`, mirroring `gatepass.level_escalates_at`);
//   * the pass carries no COO rung at all — the office was vacant the day it
//     was raised, so the CEO is level 3 on their own and always was;
//   * a pre-workflow pass (no `pass_approvals` rows, graded from the org chart)
//     whose ladder draws no COO rung either, for the same reason.
//
// Everything else drops the box: the COO signed it, the COO still holds it, or
// the rung was closed as `not_required`.
import { withEscalation } from './approvalDecision';
import type { ApprovalStep } from './passLadderLegs';
import type { PassApprovalRow } from './passApprovalState';

const CEO = 'ceo';
const COO = 'coo';

/**
 * Does the CEO's rung belong on the printed slip?
 *
 * `steps` is only consulted for a pass with NO approval rows — one raised
 * before 046, graded from the org chart, where "is there a COO rung" is the
 * only question that can be asked at all.
 */
export function ceoBoxApplies(
  steps: ApprovalStep[],
  approvals: PassApprovalRow[],
  passCreatedAt: string,
  hours: number,
  now: Date = new Date(),
): boolean {
  if (approvals.length === 0) {
    return !steps.some((s) => s.office === COO);
  }

  const ceo = approvals.find((r) => r.role_key === CEO);
  // No rung, no box: `buildApprovalSteps` draws nothing for an office this pass
  // was never routed to, and there is nothing here to remove.
  if (!ceo) return false;
  if (ceo.status === 'approved' || ceo.status === 'rejected') return true;
  // The other office on the level signed it. Nobody will ever sign this one.
  if (ceo.status === 'not_required') return false;

  // Pending. `withEscalation` fills `escalates_at` ONLY when this office is
  // genuinely waiting behind a pending sibling on its own level — so a null
  // here means nobody is ahead of the CEO and the rung is already theirs.
  const escalated = withEscalation(approvals, passCreatedAt, hours)
    .find((r) => r.role_key === CEO)?.escalates_at;
  return !escalated || Date.parse(escalated) <= now.getTime();
}

/**
 * The ladder as the PAPER prints it — every rung the record draws, less the
 * CEO's when this pass was never the CEO's to sign.
 *
 * Applied to the STEPS rather than to the finished boxes so the printed slip
 * and the record are built from one derivation with one office removed, rather
 * than from two ladders that could drift.
 */
export function printedSteps(
  steps: ApprovalStep[],
  approvals: PassApprovalRow[],
  passCreatedAt: string,
  hours: number,
  now: Date = new Date(),
): ApprovalStep[] {
  if (ceoBoxApplies(steps, approvals, passCreatedAt, hours, now)) return steps;
  return steps.filter((s) => s.office !== CEO);
}
