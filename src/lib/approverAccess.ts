// AN APPROVAL OFFICE IS ITS OWN KIND OF ACCESS, and it is deliberately not a
// role.
//
// `public.profiles.role` is VMS's enum and this app does not add to it (the
// two-schema rule), so there is no `ceo` role to sign in as. Migration 046
// creates an office holder as VMS `staff` — the role for "does not use VMS" —
// and the row in `gatepass.approval_roles` is what actually grants them
// everything: the RLS arm that shows them the passes routed to their office,
// the two RPCs that decide one, and the route below.
//
// SO A PERSON HAS A ROLE *AND* AN OFFICE, never an office instead of a role —
// in the DATABASE. Migration 043 explicitly allows the Security Head to be a
// `guard` account.
//
// WHAT THEY MAY REACH IN THIS APP IS NOW DECIDED BY THE OFFICE ALONE (client,
// 2026-08-22: "remove all the tabs. Only keep my approvals and the delegation").
// This paragraph used to argue the opposite — that such a person keeps their
// gate screens and gains a queue — and the client stopped it by name, having
// watched the Security Head clear returns on passes they also sign. See
// `officeReplacesRole` in `roleRoutes.ts` for the rule and the one exemption
// (admin, so a mistaken designation stays recoverable).
import { gp } from '../supabaseClient';
import type { ApprovalRoleKey } from './approvalLadder';

// `APPROVER_ROUTES` and `APPROVER_HOME` live in `roleRoutes.ts`, which imports
// nothing: route protection is tested against that module directly, and it must
// not pull a live Supabase client in behind it.

/**
 * The office this user holds, or null.
 *
 * A FAILURE IS "NO OFFICE", not an error: the RPC is called during the same
 * resolution that decides whether the app renders at all, and a dropped packet
 * must not lock a guard out of their own dashboard. The cost is that a genuine
 * outage hides an approver's queue — which is visible and recoverable, where
 * the alternative is an app that refuses to load.
 */
export async function fetchMyApprovalRole(): Promise<ApprovalRoleKey | null> {
  try {
    const { data, error } = await gp().rpc('my_approval_role');
    if (error) return null;
    // ONLY A NON-EMPTY STRING IS AN OFFICE. `my_approval_role()` returns a text
    // scalar, so anything else — null, an empty string, or the `[]` PostgREST
    // hands back for a shape this client did not expect — means "no office".
    // That became load-bearing on 2026-08-22, when holding an office started
    // REPLACING the role's access (roleRoutes.ts): a truthy non-answer would
    // strip a guard of every gate screen and leave them on an empty queue.
    return typeof data === 'string' && data.length > 0 ? (data as ApprovalRoleKey) : null;
  } catch {
    return null;
  }
}
