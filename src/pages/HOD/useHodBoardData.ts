// Everything the HOD board reads, and the two scopes it reads it under.
//
// Extracted from HOD/Dashboard.tsx so that file stays under the 300-line cap
// and is only layout. The interesting decisions all live here:
//
//   Department scope is RLS's, not ours. `gate_passes_select` (002) shows an
//   HOD only `department_id in (select my_department_ids())`, and since `032` a
//   person holds at most one department. No query below asks for it.
//
//   Person scope IS ours: `.eq('raised_by', userId)` on every pass read. A
//   department may host more than one HOD and the client asked for this board
//   to be the reader's own (2026-08-17). Server-side deliberately — filtering
//   client-side would download a colleague's passes in order to hide them.
//
// Nothing here aggregates. ONE read of `v_gate_passes`, and the page derives
// every figure from that one array with `buildHodKpis`, so a figure and the
// stacked list its click opens are the same array by construction.
//
// A SECOND, NARROWED READ carries the approval strip: `pass_approvals` rows for
// exactly the pass ids the first read returned — the same shape
// `useOpenReturns.ts` uses for its items query, because `pass_approvals` has no
// `raised_by` of its own to scope by. `hodApprovals.ts` turns the pair into the
// four office counts; this hook only fetches.
import { useCallback, useEffect, useState } from 'react';
import { supabase, gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { fetchMyProfile } from '../../lib/profiles';
import type { PendingApprovalRow } from '../../lib/hodApprovals';

export type HodBoardData = {
  rows: GatePassView[];
  /** `gatepass.pass_approvals` rows for this HOD's passes — see the header. */
  approvals: PendingApprovalRow[];
  /** The reader's own full name, for the greeting. Null until it resolves, and
   *  null forever if it never does — the greeting falls back to "HOD" rather
   *  than surfacing an error for a cosmetic read. */
  name: string | null;
  loading: boolean;
  error: string | null;
};

export function useHodBoardData(): HodBoardData {
  const [userId, setUserId] = useState<string | null>(null);
  const [noUser, setNoUser] = useState(false);
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [approvals, setApprovals] = useState<PendingApprovalRow[]>([]);
  const [name, setName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Who "her or him" is. Every read waits for this rather than firing
  // unfiltered and narrowing afterwards.
  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        const id = data?.user?.id ?? null;
        setUserId(id);
        if (!id) setNoUser(true);
      })
      .catch(() => {
        if (!cancelled) setNoUser(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (silent = false) => {
      if (!userId) return;
      if (!silent) setLoading(true);
      // Cleared UP FRONT, never on the success path: a refresh that resolves in
      // the same microtask queue as a failed action would otherwise wipe the
      // banner before it ever rendered (the 2026-08-13 BlacklistTab bug).
      setError(null);
      try {
        const passRes = await gp()
          .from('v_gate_passes')
          .select('*')
          .eq('raised_by', userId)
          .order('created_at', { ascending: false });
        if (passRes.error) throw passRes.error;
        const passes = (passRes.data as GatePassView[] | null) ?? [];
        setRows(passes);

        if (passes.length === 0) {
          setApprovals([]);
          return;
        }
        const approvalRes = await gp()
          .from('pass_approvals')
          .select('gate_pass_id, role_key, status')
          .in('gate_pass_id', passes.map((p) => p.id));
        // A page that refuses to render because this read failed is worse than
        // one whose strip reads all zero — the four cards above still work.
        setApprovals(
          approvalRes.error ? [] : ((approvalRes.data as PendingApprovalRow[] | null) ?? []),
        );
      } catch (err) {
        setError(safeErrorMessage(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // The greeting only. A profile that never resolves leaves "Good morning, HOD",
  // so this read has no error surface of its own.
  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((p) => {
        if (!cancelled) setName(p?.full_name ?? null);
      })
      .catch(() => {
        /* the greeting falls back to "HOD" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A board that can never identify its reader must stop showing skeletons and
  // say so, rather than spinning forever on an empty session.
  useEffect(() => {
    if (!noUser) return;
    setLoading(false);
    setError('Could not identify your account. Sign out and back in.');
  }, [noUser]);

  // Realtime: any change to gate_passes triggers a SILENT re-load, so the
  // numbers move in place instead of flashing skeletons. Defensive because a
  // partially-mocked supabase client (tests) may not implement `channel()`.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('hod-dashboard-gate-passes')
        .on('postgres_changes', { event: '*', schema: 'gatepass', table: 'gate_passes' }, () => {
          void load(true);
        })
        .subscribe();
    } catch {
      // No realtime available — the page still works via the initial load.
    }
    return () => {
      try {
        if (ch) supabase.removeChannel(ch);
      } catch {
        // ignore cleanup failures
      }
    };
  }, [load]);

  return { rows, approvals, name, loading, error };
}
