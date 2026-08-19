// Who currently holds each of the four approval offices (migration 043).
//
// ONE RPC, and it is deliberately not a table read: `gatepass.approval_roles`
// carries user ids, and the name and department behind them live in VMS's
// `public.profiles` / `public.departments`, which this app must reach through
// its own SECURITY DEFINER function rather than by joining across schemas in
// the browser (`gatepass.profile_names` carries no department, and its own
// comment forbids adding one).
//
// A FAILURE IS AN EMPTY LADDER, NOT AN ERROR SCREEN. The four names are
// decoration on a record that is perfectly readable without them — the pass,
// its material and its gate history all come from somewhere else. So a broken
// read leaves every office reading "Not designated yet" and the record still
// renders. The alternative is a pass a guard cannot see because an org-chart
// lookup failed.
import { useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import type { ApprovalRoleRow } from './approvalLadder';

export function useApprovalRoles(): ApprovalRoleRow[] {
  const [roles, setRoles] = useState<ApprovalRoleRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await gp().rpc('get_approval_ladder');
        if (cancelled || error) return;
        setRoles((data as ApprovalRoleRow[] | null) ?? []);
      } catch {
        /* An empty ladder is the fallback — see the header comment. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return roles;
}
