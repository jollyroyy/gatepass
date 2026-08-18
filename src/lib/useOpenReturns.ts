// Everything still out, and the lines under it — the one read behind BOTH
// Overdue Items and Returns Due Today.
//
// TWO QUERIES, NEVER AN AGGREGATE. Same invariant as the boards: a figure on
// those pages is `rows.length` of the very array beside it, so the counting
// happens in `src/lib/overdueItems.ts` over these arrays and nowhere else.
//
// SCOPE IS SERVER-SIDE, and there are two layers of it:
//
//   Department — RLS's. `gate_passes_select` (002) shows an HOD only their own
//                department's passes; a guard and an admin see the site. No
//                query here asks for that.
//   Person     — ours, and ONLY for the HOD: `.eq('raised_by', userId)`, the
//                same rule useHodBoardData.ts applies to the HOD board. Filtering
//                client-side would download a colleague's passes in order to
//                hide them.
//
// The items query cannot be person-scoped — `v_gate_pass_items` carries no
// `raised_by` — so it is narrowed by the pass ids that survived the pass query.
// A line whose parent is not in `passes` is dropped again in
// `buildOverdueRows`, so nothing widens even if the view changes shape.
import { useCallback, useEffect, useState } from 'react';
import { gp, supabase } from '../supabaseClient';
import type { GatePassItemView, GatePassView } from '../types';
import { safeErrorMessage } from './errors';

export type OpenReturns = {
  passes: GatePassView[];
  items: GatePassItemView[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

/** @param ownPassesOnly the HOD's person scope. False for a guard and an admin. */
export function useOpenReturns(ownPassesOnly: boolean): OpenReturns {
  const [passes, setPasses] = useState<GatePassView[]>([]);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [noUser, setNoUser] = useState(false);

  useEffect(() => {
    if (!ownPassesOnly) return;
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
  }, [ownPassesOnly]);

  const load = useCallback(
    async (silent = false) => {
      if (ownPassesOnly && !userId) return;
      if (!silent) setLoading(true);
      // Cleared UP FRONT, never on the success path — a refresh resolving in the
      // same microtask queue as a failed action would wipe the banner before it
      // rendered (the 2026-08-13 BlacklistTab bug).
      setError(null);
      try {
        // BOTH open return states. `partially_returned` still owes material:
        // dropping it once made the remaining lines of a part-returned pass
        // unreachable from every screen that could record them.
        let q = gp()
          .from('v_gate_passes')
          .select('*')
          .in('return_status', ['awaiting_return', 'partially_returned']);
        if (ownPassesOnly && userId) q = q.eq('raised_by', userId);
        const passRes = await q.order('expected_return_date', { ascending: true, nullsFirst: false });
        if (passRes.error) throw passRes.error;
        const rows = (passRes.data as GatePassView[] | null) ?? [];
        setPasses(rows);

        if (rows.length === 0) {
          setItems([]);
          return;
        }
        const itemRes = await gp()
          .from('v_gate_pass_items')
          .select('*')
          .in('gate_pass_id', rows.map((p) => p.id))
          .order('line_no');
        // A page that refuses to render because the lines query failed is worse
        // than one that shows no lines: the header still says what is out.
        setItems(itemRes.error ? [] : ((itemRes.data as GatePassItemView[] | null) ?? []));
      } catch (err) {
        setError(safeErrorMessage(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [ownPassesOnly, userId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // A page that can never identify its reader must stop showing skeletons and
  // say so, rather than spinning forever on an empty session.
  useEffect(() => {
    if (!noUser) return;
    setLoading(false);
    setError('Could not identify your account. Sign out and back in.');
  }, [noUser]);

  // Realtime: a return recorded at another gate updates this silently — no
  // skeleton flash while somebody is reading the table. Defensive because a
  // partially-mocked client (tests) may not implement `channel()`.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('open-returns-gate-passes')
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
  }, [load]);

  return { passes, items, loading, error, reload: () => load() };
}
