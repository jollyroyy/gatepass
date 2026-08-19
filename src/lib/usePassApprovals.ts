// What ONE pass owes the four approval offices, and what has been decided
// about it (migration 046).
//
// This is the per-pass counterpart of `useApprovalRoles`, which reads the org
// chart — who holds each office right now. The two are not interchangeable and
// the record needs both: the chart supplies a department beside a name, and
// this supplies the decision. A pass raised before anybody was designated has
// no rows here at all, and `buildApprovalSteps` grades it the old way.
//
// A FAILURE IS AN EMPTY LADDER, NOT AN ERROR SCREEN — the same rule
// `useApprovalRoles` follows and for the same reason: the pass, its material
// and its gate history all come from elsewhere, and a record that refuses to
// render because an approval read failed is worse than one that shows the
// levels it could not grade.
import { useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import type { PassApprovalRow } from './approvalLadder';

export function usePassApprovals(passId: string | null | undefined): PassApprovalRow[] {
  const [rows, setRows] = useState<PassApprovalRow[]>([]);

  useEffect(() => {
    if (!passId) {
      setRows([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await gp().rpc('get_pass_approvals', { p_pass_id: passId });
        if (cancelled || error) return;
        setRows((data as PassApprovalRow[] | null) ?? []);
      } catch {
        /* An empty ladder is the fallback — see the header comment. */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [passId]);

  return rows;
}
