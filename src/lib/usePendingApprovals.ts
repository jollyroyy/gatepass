// The reads behind the Pending Approvals screen (migration 046): every
// `pass_approvals` row this reader may see, and the passes those rows belong
// to — the queue waiting on their signature AND everything they have already
// approved or rejected (client, 2026-08-20: "all four approvers should be able
// to see all the gate passes that they have approved and rejected").
//
// THE APPROVALS ARE READ FIRST AND THE PASSES ARE NARROWED TO THEM. It used to
// be two parallel reads with the passes fixed at `status = 'pending'` — which
// is exactly the set a history cannot come out of, since a pass approved last
// week has moved on. Dropping that filter without narrowing would hand a
// Security Head who is also a `guard` account the whole register (046 gives a
// guard every pass that owes no signature); asking `pass_approvals` first and
// fetching by id gives both lists their rows and nothing else.
//
// No aggregate. RLS (`pass_approvals_select_with_pass`, 046) already scopes the
// first read to what this reader may see, so `.in('id', …)` narrows a query
// rather than deciding access — the policies still do that.
//
// THE SIGNED-IN UID IS PART OF THE ANSWER: a decision is a fact about the
// person who pressed the button, not about the office, so `decidedByMe` needs
// it. It is resolved once, defensively — a failure leaves the two history
// lists empty rather than showing somebody else's signatures.
//
// AFTER approve/reject THE LIST IS RE-READ, NEVER PATCHED (`reload`) — only the
// database knows whether that press was the pass's last pending level, and
// whether the caller's OWN queue moved because someone above them just cleared
// it.
import { useCallback, useEffect, useState } from 'react';
import { gp, supabase } from '../supabaseClient';
import type { GatePassView } from '../types';
import type { PassApproval } from './pendingApprovals';
import { passIdsOnMyLadder } from './approvalHistory';
import { safeErrorMessage } from './errors';

export interface PendingApprovalsData {
  passes: GatePassView[];
  approvals: PassApproval[];
  /** The signed-in user's own uid, or `null` until it resolves (or if it
   *  never does). Only `decidedByMe` reads it. */
  userId: string | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePendingApprovals(office: string | null): PendingApprovalsData {
  const [passes, setPasses] = useState<GatePassView[]>([]);
  const [approvals, setApprovals] = useState<PassApproval[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      // No office held: nothing to query, and no query is made — the caller
      // renders the no-office state before this even runs.
      if (!office) {
        setPasses([]);
        setApprovals([]);
        setLoading(false);
        setError(null);
        return;
      }
      if (!silent) setLoading(true);
      try {
        let uid: string | null = null;
        try {
          const { data } = await supabase.auth.getUser();
          uid = data?.user?.id ?? null;
        } catch {
          // No session resolved: the queue still loads, and the two history
          // lists stay empty rather than guessing whose signature is whose.
        }
        setUserId(uid);

        const approvalRes = await gp().from('pass_approvals').select('*');
        if (approvalRes.error) throw approvalRes.error;
        const rows = (approvalRes.data as PassApproval[] | null) ?? [];
        setApprovals(rows);

        const ids = passIdsOnMyLadder(rows, uid, office);
        if (ids.length === 0) {
          // Nothing has ever been routed to this office. `.in('id', [])` is a
          // query with no possible result — skip it rather than make it.
          setPasses([]);
          setError(null);
          return;
        }
        const passRes = await gp().from('v_gate_passes').select('*').in('id', ids);
        if (passRes.error) throw passRes.error;
        setPasses((passRes.data as GatePassView[] | null) ?? []);
        setError(null);
      } catch (err) {
        setError(safeErrorMessage(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [office]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime, defensive: a partially-mocked client (tests) may not implement
  // `channel()`. Silent refresh so the queue never flashes a skeleton while
  // another office's decision moves a pass through the ladder.
  useEffect(() => {
    if (!office) return undefined;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('pending-approvals-gate-passes')
        .on('postgres_changes', { event: '*', schema: 'gatepass', table: 'gate_passes' }, () => {
          void load(true);
        })
        .subscribe();
    } catch {
      // No realtime available — the initial load still populated the page.
    }
    return () => {
      try {
        if (ch) supabase.removeChannel(ch);
      } catch {
        // ignore cleanup failures
      }
    };
  }, [load, office]);

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { passes, approvals, userId, loading, error, reload };
}
