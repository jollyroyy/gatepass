// WHAT THIS OFFICE HOLDER HAS ALREADY DECIDED (client, 2026-08-20: "all four
// approvers should be able to see all the gate passes that they have approved
// and rejected. Make a KPI card for that in the dashboard").
//
// Pure. No queries, no React — the same split every derivation module in
// `src/lib` follows, and the same one `pendingApprovals.ts` follows for the
// queue that sits beside these two figures.
//
// THE TEST IS `decided_by`, NOT THE OFFICE. A decision is a fact about the
// PERSON who pressed the button: `approve_pass_level` writes their own uid, so
// somebody re-designated from the COO's chair to the CEO's still owns every
// signature they gave, and a pass their SUCCESSOR signed for the office they
// used to hold is not theirs to claim. That is also what keeps these two lists
// honest on a deployment where one inbox receives every office's letter.
//
// TWO ROWS THIS DELIBERATELY EXCLUDES, both of which carry a status of
// `approved` and neither of which anybody signed:
//
//   * a GRANDFATHERED rung (058) — `decided_by` is NULL by design, because the
//     rollout closed it and no human approved it;
//   * an EMERGENCY RELEASE (055) — `decided_by` is the super admin who cleared
//     the level, and they hold none of these offices.
//
// Both fall out of the `decided_by === userId` test for free; there is no
// second predicate to keep in step.
import type { GatePassView } from '../types';
import type { PassApproval } from './pendingApprovals';

export type DecidedOutcome = 'approved' | 'rejected';

/** The passes this person decided one way, most recently decided first — the
 *  opposite order to the queue beside it, and for the opposite reason: a queue
 *  is read oldest-first because the longest wait is the next job, and a history
 *  is read newest-first because the last thing you did is the thing you are
 *  most likely looking for.
 *
 *  Ties break on `pass_number` so the order is stable between renders. */
export function decidedByMe(
  passes: GatePassView[],
  approvals: PassApproval[],
  userId: string | null,
  outcome: DecidedOutcome,
): GatePassView[] {
  if (!userId) return [];
  const when = new Map<string, string>();
  for (const a of approvals) {
    if (a.status !== outcome) continue;
    if (a.decided_by !== userId) continue;
    // A pass has at most one rung per office and a person holds one office, so
    // this cannot collide in practice; `coalesce` to the created stamp keeps a
    // row with no moment sortable rather than dropping it out of the list.
    when.set(a.gate_pass_id, a.decided_at ?? a.created_at);
  }
  return passes
    .filter((p) => when.has(p.id))
    .sort((a, b) => {
      const byDate = (when.get(b.id) ?? '').localeCompare(when.get(a.id) ?? '');
      return byDate !== 0 ? byDate : a.pass_number.localeCompare(b.pass_number);
    });
}

/** Every pass id this office has a rung on, decided or not — what the record
 *  read must fetch so the queue and both history lists can be derived from one
 *  array. `pass_approvals` is already scoped by RLS to what this reader may
 *  see, so this narrows a query rather than deciding access. */
export function passIdsOnMyLadder(
  approvals: PassApproval[],
  userId: string | null,
  /** Every office this reader may act for — two while a COO/CEO delegation is
   *  live (072), and a pass routed to EITHER is one they have to be able to
   *  open. */
  offices: string[],
): string[] {
  const ids = new Set<string>();
  for (const a of approvals) {
    if (offices.includes(a.role_key) || (userId !== null && a.decided_by === userId)) {
      ids.add(a.gate_pass_id);
    }
  }
  return [...ids];
}
