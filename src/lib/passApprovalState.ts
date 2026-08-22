// WHAT ONE PASS OWES THE FOUR APPROVAL OFFICES, and how each answer reads.
//
// Split out of `approvalLadder.ts` only because that module reached its 300-line
// cap; the seam is a real one all the same. This is the shape of
// `gatepass.get_pass_approvals()` (migration 046) plus the two lookups that turn
// a database status into something a reader sees, and it is imported by the
// ladder, by the hook that fetches it and by anything else that needs to say
// what a level has decided — none of which should restate the mapping.
import type { ApprovalRoleKey, ApprovalStepState } from './approvalLadder';

/** One row of `gatepass.get_pass_approvals()` — what THIS pass owes, and what
 *  has been decided about it (migration 046). `routed_name` is who held the
 *  office the day the pass was raised; `decided_name` is who actually pressed
 *  the button, which is not always the same person. */
/** What one office's row on one pass says. `not_required` arrived with 063:
 *  the COO and the CEO share level 3, and whichever of them signs it closes the
 *  other's row as never having been needed. It is NOT `approved` — nobody
 *  signed it, `decided_by` is null on such a row by the database's own CHECK,
 *  and the printed slip must not tick a box for a signature that was never
 *  given. */
export type PassApprovalStatus = 'pending' | 'approved' | 'rejected' | 'not_required';

export interface PassApprovalRow {
  role_key: ApprovalRoleKey;
  level_no: number;
  status: PassApprovalStatus;
  routed_name: string | null;
  decided_name: string | null;
  decided_at: string | null;
  reason: string | null;
  /** True when `decided_name` signed as the office's STANDING DEPUTY rather
   *  than as its holder (migration 054). Stored on the decision, not derived
   *  from today's ladder: both seats move, and re-pointing an office next month
   *  must not rewrite who signed this pass last month. */
  decided_as_deputy: boolean;
  /** True when `decided_name` signed under a TIME-BOXED DELEGATION of that
   *  office (migration 062) rather than as its holder or standing deputy.
   *  Stored on the decision for the reason `decided_as_deputy` is: a delegation
   *  expires, and a rung must not quietly re-credit the holder the day after
   *  the window closed. OPTIONAL, and falsy is the safe reading — a fixture or
   *  a row decided before 062 describes an ordinary decision. */
  decided_as_delegate?: boolean;
  /** Who delegated the office, resolved through `delegation_id` at read time
   *  (client, 2026-08-22: the record must name "the approver who was delegated
   *  by the original approver and the approver's name"). Null when this was not
   *  a delegated decision — or when the name failed to resolve out of VMS, in
   *  which case the rung still says it was signed under a delegation and simply
   *  cannot say by whose. */
  delegated_by_name?: string | null;
  /** True when this level was closed by the 058 ROLLOUT rather than by a person
   *  — the pass was raised before the approval workflow began, so no office was
   *  ever asked to sign it. `decided_name` is null on such a row BY DESIGN, and
   *  the ladder must print the rollout sentence rather than falling back to
   *  `routed_name`: that name is whoever held the office the day the pass was
   *  raised, and printing it here would say they approved something they never
   *  saw. OPTIONAL, and falsy is the safe reading — a fixture or a row from
   *  before 058 describes an ordinary decision. */
  grandfathered?: boolean;
  /** WHEN A SHARED RUNG BECOMES THIS OFFICE'S TO SIGN (migration 063). Filled
   *  in by `withEscalation` from the rows the caller already holds — it is not
   *  a column and does not come back from `get_pass_approvals`. Null on every
   *  ordinary rung. */
  escalates_at?: string | null;
}

/** How a decided (or undecided) level reads. A `Record` and not a chain, so a
 *  fifth status in the database is a type error here rather than a blank rung. */
export const APPROVAL_STATE: Record<PassApprovalStatus, ApprovalStepState> = {
  pending: 'pending',
  approved: 'done',
  rejected: 'blocked',
  not_required: 'skipped',
};

export const APPROVAL_NOTE: Record<PassApprovalStatus, string> = {
  pending: 'Waiting for this approval',
  approved: 'Approved',
  rejected: 'Rejected',
  // The database writes the fuller sentence ("Not required — level 3 was
  // approved by the COO.") into `reason`, and the ladder prefers it. This is
  // the fall-back for a row that somehow carries none.
  not_required: 'Not required',
};

/** What a level closed by the rollout says instead of a name and a note. Stated
 *  once, here, because the ladder and anything else that renders a rung must
 *  agree — a rung that reads "Approved" with no author is indistinguishable
 *  from a bug. */
export const GRANDFATHERED_NOTE =
  'Approved on rollout — raised before the approval workflow began';
