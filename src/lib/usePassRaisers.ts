// The reads and writes behind the HOD's Pass Raisers tab (migration 077).
//
// THREE RPCs AND NO TABLE QUERY: `gatepass.pass_raisers` is RLS-on with no
// policy and no grant, so these functions are the only way in — the shape 062's
// `approval_delegations` takes, and for the same reason. The table says who may
// raise material in whose name, which is not something every signed-in account
// should be able to enumerate.
//
// A FAILED READ IS AN ERROR ON THE PAGE, NOT AN EMPTY ONE. An empty list reads
// as "you have authorised nobody", which is exactly the belief that would have
// an HOD authorise a second person while the first is already live.
//
// THE CANDIDATE LIST IS ALLOWED TO FAIL ON ITS OWN, as `useApprovalDelegations`
// lets its own: `list_raiser_candidates` refuses anybody who is not an HOD, so a
// reader who has lost the role mid-session gets a refusal from it while their
// own history reads perfectly well. That is an answer, not an error state.
import { useCallback, useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import { safeErrorMessage } from './errors';
import type { PassRaiserRow, RaiserCandidate, RaisingGrant } from './passRaising';

export interface PassRaisersState {
  rows: PassRaiserRow[];
  candidates: RaiserCandidate[];
  /** False when this reader is not an HOD of any department — there is nothing
   *  for them to hand over, and the form is not drawn. */
  canAuthorise: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function usePassRaisers(): PassRaisersState {
  const [rows, setRows] = useState<PassRaiserRow[]>([]);
  const [candidates, setCandidates] = useState<RaiserCandidate[]>([]);
  const [canAuthorise, setCanAuthorise] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await gp().rpc('list_my_pass_raisers');
      if (err) throw err;
      setRows((data as PassRaiserRow[] | null) ?? []);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not read who you have authorised.'));
      setRows([]);
    }

    // Separately, and deliberately not inside the try above: a refusal here is
    // an answer ("you head no department"), not a failure of the page.
    try {
      const { data, error: err } = await gp().rpc('list_raiser_candidates');
      if (err) throw err;
      setCandidates((data as RaiserCandidate[] | null) ?? []);
      setCanAuthorise(true);
    } catch {
      setCandidates([]);
      setCanAuthorise(false);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { rows, candidates, canAuthorise, loading, error, reload };
}

/** Write one. Separate from the hook because a mutation is not state: the page
 *  calls this and then `reload()`, never patching the list it holds — only the
 *  database knows the status the new row came out with, and whether the window
 *  it just wrote overlaps something. */
export async function createPassRaiser(args: {
  p_raiser_id: string;
  p_starts_at: string;
  p_ends_at: string;
  p_reason: string | null;
}): Promise<void> {
  const { error } = await gp().rpc('create_pass_raiser', args);
  if (error) throw new Error(safeErrorMessage(error, 'Could not authorise that person.'));
}

/** End one early. Not a delete — the row stays in the history saying who was
 *  authorised and that it was stopped before its time, and the passes already
 *  raised under it keep the HOD rung they carry. */
export async function revokePassRaiser(id: string): Promise<void> {
  const { error } = await gp().rpc('revoke_pass_raiser', { p_id: id });
  if (error) throw new Error(safeErrorMessage(error, 'Could not revoke that authority.'));
}

/**
 * THE GRANT THIS READER HOLDS, if any — resolved once at sign-in beside the role
 * and the office, in `App.tsx`.
 *
 * A FAILURE IS "NO GRANT", not an error, exactly as `fetchMyApprovalOffices`
 * treats its own: this call runs during the resolution that decides whether the
 * app renders at all, and a dropped packet must not lock a guard out of their
 * own dashboard. The cost is stated plainly — a genuine outage hides an
 * assistant's Raise tab, which is visible and recoverable, where the alternative
 * is an app that refuses to load.
 */
export async function fetchMyRaisingGrant(): Promise<RaisingGrant | null> {
  try {
    const { data, error } = await gp().rpc('my_raising_grant');
    if (error) return null;
    if (!Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as RaisingGrant;
    return row && typeof row.department_id === 'string' ? row : null;
  } catch {
    return null;
  }
}
