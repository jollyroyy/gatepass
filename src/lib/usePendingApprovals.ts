// The two reads behind the Pending Approvals screen (migration 046): every
// pending pass, and every `pass_approvals` row for it.
//
// Two reads, no aggregate — the same shape `useGuardQueues.ts` follows. RLS
// (`pass_approvals_select_with_pass`, 046) already scopes both tables to what
// this reader may see, so the `pass_approvals` read is left unnarrowed rather
// than adding a second `.in('gate_pass_id', …)` that could only ever agree
// with what the server already filtered.
//
// AFTER approve/reject THE LIST IS RE-READ, NEVER PATCHED (`reload`) — only the
// database knows whether that press was the pass's last pending level, and
// whether the caller's OWN queue moved because someone above them just cleared
// it.
import { useCallback, useEffect, useState } from 'react';
import { gp, supabase } from '../supabaseClient';
import type { GatePassView } from '../types';
import type { PassApproval } from './pendingApprovals';
import { safeErrorMessage } from './errors';

export interface PendingApprovalsData {
  passes: GatePassView[];
  approvals: PassApproval[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function usePendingApprovals(office: string | null): PendingApprovalsData {
  const [passes, setPasses] = useState<GatePassView[]>([]);
  const [approvals, setApprovals] = useState<PassApproval[]>([]);
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
        const [passRes, approvalRes] = await Promise.all([
          gp().from('v_gate_passes').select('*').eq('status', 'pending'),
          gp().from('pass_approvals').select('*'),
        ]);
        if (passRes.error) throw passRes.error;
        if (approvalRes.error) throw approvalRes.error;
        setPasses((passRes.data as GatePassView[] | null) ?? []);
        setApprovals((approvalRes.data as PassApproval[] | null) ?? []);
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

  return { passes, approvals, loading, error, reload };
}
