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
// SO A PERSON HAS A ROLE *AND* AN OFFICE, never an office instead of a role.
// That is not tidiness — migration 043 explicitly allows the Security Head to
// be a `guard` account, and collapsing the two into one union would make such a
// person choose between their gate screens and their approval queue. A guard
// who holds an office keeps `/guard-dashboard` as their home and gains
// `/approvals`; a `staff` account with an office has nothing else, so
// `/approvals` IS their home.
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
    return (data as ApprovalRoleKey | null) ?? null;
  } catch {
    return null;
  }
}
