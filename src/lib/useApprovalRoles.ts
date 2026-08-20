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
import { useCallback, useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import type { ApprovalRoleRow } from './approvalLadder';

/** The ladder, plus a way to read it again.
 *
 *  `reload` exists because DEACTIVATING AN OFFICE HOLDER VACATES THEIR OFFICE
 *  (migration 059): a list read once at mount would keep naming somebody the
 *  database no longer seats, and the Users tab decides how to reactivate a
 *  person from exactly this map. */
export function useApprovalRoles(): { roles: ApprovalRoleRow[]; reload: () => Promise<void> } {
  const [roles, setRoles] = useState<ApprovalRoleRow[]>([]);

  const reload = useCallback(async () => {
    try {
      const { data, error } = await gp().rpc('get_approval_ladder');
      if (error) return;
      setRoles((data as ApprovalRoleRow[] | null) ?? []);
    } catch {
      /* An empty ladder is the fallback — see the header comment. */
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  return { roles, reload };
}
