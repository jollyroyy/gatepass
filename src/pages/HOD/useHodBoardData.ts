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
// Nothing here aggregates. The page filters the one `rows` array by period and
// hands slices to the chart modules, so a figure and the list its click opens
// are always the same array.
import { useCallback, useEffect, useState } from 'react';
import { supabase, gp, pub } from '../../supabaseClient';
import type { GatePassItemView, GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';

const FLAGGED_LIMIT = 5;

export type HodBoardData = {
  rows: GatePassView[];
  /** Line rows for the ranked panels. `v_gate_pass_items` has no `raised_by` of
   *  its own — RLS scopes it to this HOD's DEPARTMENT — so a colleague's line
   *  can arrive here. Both panels ignore any item whose parent pass is not in
   *  `rows`, which is already person-scoped, so nothing widens. */
  items: GatePassItemView[];
  /** UNSCOPED by period on purpose — a mismatch raised yesterday still needs a
   *  decision today, and the board's Today default must not hide it. */
  flagged: GatePassView[];
  loading: boolean;
  error: string | null;
  /** Re-reads every query. The board's Refresh button — realtime already keeps the
   *  numbers moving, but a reader who has just acted elsewhere wants to be able to
   *  ask rather than wait. */
  reload: () => Promise<void>;
};

export function useHodBoardData(): HodBoardData {
  const [userId, setUserId] = useState<string | null>(null);
  const [noUser, setNoUser] = useState(false);
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [flagged, setFlagged] = useState<GatePassView[]>([]);
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
        const [passRes, flaggedRes, itemRes] = await Promise.all([
          gp().from('v_gate_passes').select('*').eq('raised_by', userId).order('created_at', { ascending: false }),
          gp()
            .from('v_gate_passes')
            .select('*')
            .eq('raised_by', userId)
            .eq('status', 'flagged')
            .order('verified_at', { ascending: false })
            .limit(FLAGGED_LIMIT),
          gp().from('v_gate_pass_items').select('*'),
        ]);
        if (passRes.error) throw passRes.error;
        setRows((passRes.data as GatePassView[] | null) ?? []);
        // A board that refuses to render because ONE panel's query failed is
        // worse than a board with one empty panel, so a failed flagged read is
        // not fatal.
        setFlagged(flaggedRes.error ? [] : ((flaggedRes.data as GatePassView[] | null) ?? []));
        setItems(itemRes.error ? [] : ((itemRes.data as GatePassItemView[] | null) ?? []));
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

  return { rows, items, flagged, loading, error, reload: () => load() };
}

/** The HOD's own departments, by name — the page subtitle and nothing else.
 *  Failures are swallowed: a missing subtitle must not block a board. */
export function useMyDepartmentNames(): string[] {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const { data: hodDepts, error: hodErr } = await gp().from('hod_departments').select('department_id');
        if (hodErr) throw hodErr;
        const ids = (hodDepts ?? []).map((r: { department_id: string }) => r.department_id);
        if (ids.length === 0) return;
        const { data: depts, error: deptErr } = await pub().from('departments').select('id, name').in('id', ids);
        if (deptErr) throw deptErr;
        if (!cancelled) setNames((depts ?? []).map((d: { name: string }) => d.name));
      } catch {
        // Cosmetic only.
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
}
