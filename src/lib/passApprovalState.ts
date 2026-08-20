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
export interface PassApprovalRow {
  role_key: ApprovalRoleKey;
  level_no: number;
  status: 'pending' | 'approved' | 'rejected';
  routed_name: string | null;
  decided_name: string | null;
  decided_at: string | null;
  reason: string | null;
  /** True when `decided_name` signed as the office's STANDING DEPUTY rather
   *  than as its holder (migration 054). Stored on the decision, not derived
   *  from today's ladder: both seats move, and re-pointing an office next month
   *  must not rewrite who signed this pass last month. */
  decided_as_deputy: boolean;
  /** True when this level was closed by the 058 ROLLOUT rather than by a person
   *  — the pass was raised before the approval workflow began, so no office was
   *  ever asked to sign it. `decided_name` is null on such a row BY DESIGN, and
   *  the ladder must print the rollout sentence rather than falling back to
   *  `routed_name`: that name is whoever held the office the day the pass was
   *  raised, and printing it here would say they approved something they never
   *  saw. OPTIONAL, and falsy is the safe reading — a fixture or a row from
   *  before 058 describes an ordinary decision. */
  grandfathered?: boolean;
}

/** How a decided (or undecided) level reads. A `Record` and not a chain, so a
 *  fifth status in the database is a type error here rather than a blank rung. */
export const APPROVAL_STATE: Record<PassApprovalRow['status'], ApprovalStepState> = {
  pending: 'pending',
  approved: 'done',
  rejected: 'blocked',
};

export const APPROVAL_NOTE: Record<PassApprovalRow['status'], string> = {
  pending: 'Waiting for this approval',
  approved: 'Approved',
  rejected: 'Rejected',
};

/** What a level closed by the rollout says instead of a name and a note. Stated
 *  once, here, because the ladder and anything else that renders a rung must
 *  agree — a rung that reads "Approved" with no author is indistinguishable
 *  from a bug. */
export const GRANDFATHERED_NOTE =
  'Approved on rollout — raised before the approval workflow began';
