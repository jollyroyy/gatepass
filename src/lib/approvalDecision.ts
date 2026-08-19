// THE SLIP-ORDER RULE, STATED ONCE.
//
// `approve_pass_level` (migration 046) refuses a caller whose office is not the
// LOWEST still-pending rung on that pass. Two screens have to know the same
// thing before they draw a button — the approver's queue at `/approvals`, and
// the Approve / Reject bar at the foot of the gate pass record — and a second
// copy of the rule is a second thing to get wrong. Both read this module, so a
// button is never drawn on something the database would only refuse.
//
// It is generic over the ROW SHAPE because the same ladder arrives in two
// shapes: `pass_approvals` read straight off the table (the queue, which loads
// every pass's rows at once and so carries `gate_pass_id`), and
// `get_pass_approvals()` (one pass, with the holders' names joined on). Both
// carry the three fields the rule actually depends on, and nothing here needs
// any of the others.
//
// Pure. No queries, no React — the same split every derivation module in
// `src/lib` follows.
import type { ApprovalRoleKey } from './approvalLadder';

/** The three fields the rule depends on. Anything wider satisfies it. */
export interface ApprovalStepRow {
  role_key: ApprovalRoleKey;
  level_no: number;
  status: 'pending' | 'approved' | 'rejected';
}

/** The first rung nobody has signed, or `null` when every rung is decided —
 *  and `null` too for a pass with no ladder at all, which is every pass raised
 *  before an office was designated (046 snapshots on insert and backfills
 *  nothing). */
export function lowestPendingLevel<T extends ApprovalStepRow>(rows: T[]): number | null {
  const pending = rows.filter((r) => r.status === 'pending');
  if (pending.length === 0) return null;
  return Math.min(...pending.map((r) => r.level_no));
}

/** This office's own rung on this pass, or `null` when the pass is not routed
 *  to it (or the reader holds no office at all). */
export function myStep<T extends ApprovalStepRow>(
  rows: T[],
  office: ApprovalRoleKey | null,
): T | null {
  if (!office) return null;
  return rows.find((r) => r.role_key === office) ?? null;
}

/**
 * May this office decide this pass RIGHT NOW?
 *
 * Three conditions, and all three are the RPC's own: the pass is still
 * `pending` (a rejection cancels it, a gate clearance matches it, and neither
 * may be signed afterwards), my rung is still `pending`, and no earlier office
 * still owes a signature.
 */
export function canDecideApproval<T extends ApprovalStepRow>(
  passStatus: string,
  rows: T[],
  office: ApprovalRoleKey | null,
): boolean {
  if (passStatus !== 'pending') return false;
  const mine = myStep(rows, office);
  if (!mine || mine.status !== 'pending') return false;
  return lowestPendingLevel(rows) === mine.level_no;
}

/**
 * The office actually holding this pass up, when it is NOT mine to sign.
 *
 * `null` means either that it is mine or that nothing is pending — the caller
 * has already asked `canDecideApproval` and only needs a name for the wait.
 * An office holder who sees no button and no reason cannot tell a queue that
 * is not theirs yet from a screen that failed to load.
 */
export function heldByOffice<T extends ApprovalStepRow>(
  rows: T[],
  office: ApprovalRoleKey | null,
): ApprovalRoleKey | null {
  const lowest = lowestPendingLevel(rows);
  if (lowest === null) return null;
  const mine = myStep(rows, office);
  if (mine && mine.level_no === lowest) return null;
  return rows.find((r) => r.level_no === lowest && r.status === 'pending')?.role_key ?? null;
}

/** "Level 2 of 4" — where this rung sits on the pass's own ladder, which is not
 *  always four rungs: a pass snapshots only the offices that were designated
 *  the day it was raised. */
export function levelLabel<T extends ApprovalStepRow>(rows: T[], step: T): string {
  return `Level ${step.level_no} of ${rows.length}`;
}
