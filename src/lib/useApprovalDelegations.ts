// The reads behind the Delegation tab (migration 062).
//
// TWO RPCs, ONE MOUNT, and neither is a table query: `gatepass.
// approval_delegations` is RLS-on with no policy and no grant, so these
// functions are the only way in — which is deliberate, since the table says who
// covers for whom and to what value ceiling.
//
// A FAILED READ IS AN ERROR ON THE PAGE, NOT AN EMPTY ONE. This is the opposite
// call from `useApprovalRoles`, and for a reason: an empty ladder still leaves a
// perfectly readable pass record, whereas an empty delegation screen reads as
// "you have delegated nothing" — which is exactly the belief that would let
// somebody go on leave with their queue uncovered.
//
// THE CANDIDATE LIST IS ALLOWED TO FAIL ON ITS OWN. `list_delegation_candidates`
// refuses anybody who does not HOLD an office, so a standing deputy or a current
// delegate opening this page gets a refusal from it while their own history
// reads perfectly well. That is not an error state: they have nothing to
// delegate, and the page says so rather than showing them a red bar.
import { useCallback, useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import { safeErrorMessage } from './errors';
import type { DelegateCandidate, DelegationRow } from './approvalDelegation';

export interface DelegationsState {
  rows: DelegationRow[];
  candidates: DelegateCandidate[];
  /** False when this reader holds no office of their own — a deputy or a
   *  delegate, who may act but may not hand on what they are covering. */
  canDelegate: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useApprovalDelegations(): DelegationsState {
  const [rows, setRows] = useState<DelegationRow[]>([]);
  const [candidates, setCandidates] = useState<DelegateCandidate[]>([]);
  const [canDelegate, setCanDelegate] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await gp().rpc('list_my_delegations');
      if (err) throw err;
      setRows((data as DelegationRow[] | null) ?? []);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not read your delegations.'));
      setRows([]);
    }

    // Separately, and deliberately not inside the try above: a refusal here is
    // an answer ("you hold no office"), not a failure of the page.
    try {
      const { data, error: err } = await gp().rpc('list_delegation_candidates');
      if (err) throw err;
      setCandidates((data as DelegateCandidate[] | null) ?? []);
      setCanDelegate(true);
    } catch {
      setCandidates([]);
      setCanDelegate(false);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, candidates, canDelegate, loading, error, reload };
}

/** Write one. Separate from the hook because a mutation is not state: the page
 *  calls this and then `reload()`, never patching the list it holds — only the
 *  database knows whether the window it just wrote overlaps something. */
export async function createDelegation(args: {
  p_delegate_id: string;
  p_starts_at: string;
  p_ends_at: string;
  p_approval_limit: number | null;
  p_reason: string | null;
}): Promise<void> {
  const { error } = await gp().rpc('create_approval_delegation', args);
  if (error) throw new Error(safeErrorMessage(error, 'Could not create that delegation.'));
}

/** End one early. Not a delete — the row stays in the history saying who
 *  covered what and that it was stopped before its time. */
export async function revokeDelegation(id: string): Promise<void> {
  const { error } = await gp().rpc('revoke_approval_delegation', { p_id: id });
  if (error) throw new Error(safeErrorMessage(error, 'Could not revoke that delegation.'));
}
