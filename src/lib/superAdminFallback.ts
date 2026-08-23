// THE SUPER ADMIN FALLBACK — who holds it, and what "nobody has approved this"
// means (migration 067).
//
// Client, 2026-08-24: "the super admin role will be given to COO and CEO …
// Basically the Superadmin role is a kind of fallback role. In the case where
// nobody is able to approve, in those scenarios the Superadmin can take charge
// and get it approved. It's basically a role but it doesn't remove their CEO or
// COO role also."
//
// SO IT IS A POWER, NOT A PORTAL. The two office holders keep exactly the
// screens 2026-08-22 left every approver — "Pending for My Approval" and
// "Delegation" — and gain one control at the foot of a gate pass record. There
// is deliberately nothing here that touches `roleRoutes.ts`: `is_super_admin()`
// in the database is not `is_admin()`, and this module is not a role.
//
// "STUCK" IS THE SAME NUMBER THE LADDER ALREADY ESCALATES ON. A pass is stuck
// when it has sat on its current rung longer than `coo_escalation_hours` (063)
// — the window that already decides when level 3 passes from the COO to the
// CEO. One definition of "waited too long", not two, and the number is the
// admin's own setting rather than a constant invented here.
//
// MIRRORS `gatepass.pass_is_stuck` AND `holds_fallback_office`, and does not
// replace them: `emergency_release_pass` re-checks both, and the select
// policies decide on their own whether this reader may even see the pass. This
// exists so a control is never drawn where the RPC would only refuse the press.
//
// Pure — no queries, no React, `now` injected so the tests are not a race.
import type { ApprovalRoleKey } from './approvalLadder';
import { DEFAULT_ESCALATION_HOURS, lowestPendingLevel, type ApprovalStepRow } from './approvalDecision';

/** The offices that carry the fallback. THE TWO THAT SHARE THE LAST RUNG (063),
 *  which is also the pair that now covers each other's delegations (067) — one
 *  fact about the top of the ladder, stated once. */
export const FALLBACK_OFFICES: readonly ApprovalRoleKey[] = ['coo', 'ceo'];

/** Does this reader's office carry the fallback? A DEPUTY OR A DELEGATE DOES
 *  NOT, and the database agrees: emergency release is the last door in the
 *  system and belongs to the officer, not to their cover. */
export function holdsFallbackOffice(office: ApprovalRoleKey | null | undefined): boolean {
  return !!office && FALLBACK_OFFICES.includes(office);
}

/**
 * When this pass ARRIVED on the rung it is waiting on now, or null when it owes
 * no signature at all.
 *
 * The latest decision on any rung BELOW the lowest pending one, falling back to
 * the moment the pass was raised for a pass whose first rung is still open.
 * Never `now()` minus something — the same rule `withEscalation` follows, for
 * the same reason.
 *
 * `not_required` counts alongside `approved`: a rung closed because its
 * neighbour signed it (063) is a rung that has passed.
 */
export function rungReachedAt<T extends ApprovalStepRow>(
  rows: T[],
  passCreatedAt: string,
): string | null {
  const lowest = lowestPendingLevel(rows);
  if (lowest === null) return null;
  const below = rows
    .filter((r) => r.level_no < lowest
      && (r.status === 'approved' || r.status === 'not_required')
      && r.decided_at)
    .map((r) => r.decided_at as string)
    .sort();
  return below.length > 0 ? below[below.length - 1] : passCreatedAt;
}

/**
 * Has nobody approved this in time?
 *
 * Pending, still owing a signature, and on that rung longer than the escalation
 * window. A pass that is no longer `pending` is never stuck — a rejection
 * STOPPED it, and overturning a written refusal is a different and much larger
 * power that this system does not have (055's own rule).
 */
export function isPassStuck<T extends ApprovalStepRow>(
  passStatus: string,
  rows: T[],
  passCreatedAt: string,
  escalationHours: number = DEFAULT_ESCALATION_HOURS,
  now: number = Date.now(),
): boolean {
  if (passStatus !== 'pending') return false;
  const reached = rungReachedAt(rows, passCreatedAt);
  if (!reached) return false;
  return Date.parse(reached) + escalationHours * 3600_000 <= now;
}

/** The sentence the queue's fourth card and the break-glass panel both carry.
 *  Stated once so the figure and the control cannot describe different rules. */
export function stuckNote(escalationHours: number): string {
  return `No approval for over ${escalationHours} hours — you can release it in writing`;
}
