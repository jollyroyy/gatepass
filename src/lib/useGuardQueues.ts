// The two reads behind every guard screen — the gate queue and everything
// still out — in one place, so the dashboard's cards and the pages those cards
// open can never ask the database two different questions.
//
// THE BOARD'S OLDEST INVARIANT DEPENDS ON THIS. A figure on the dashboard is
// `rows.length` of an array derived from these queries, and the page it drills
// into derives its rows from the same query with the same predicate
// (`pendingOutOf` / `pendingReturnsOf` in guardBoard.ts). No aggregate, no
// `count: 'exact'`, no second predicate that could drift.
//
// `scope` exists so a page loads only what it renders: the Pending OUT page has
// no use for the return backlog, and a screen at a barrier should not be
// waiting on a query nothing on it will show.
import { useCallback, useEffect, useState } from 'react';
import { gp, supabase } from '../supabaseClient';
import type { GatePassItemView, GatePassView } from '../types';
import { safeErrorMessage } from './errors';

export type GuardQueueScope = 'both' | 'out' | 'returns';

export interface GuardQueues {
  /** Waiting on the gate: `pending` / `hod_reviewed`, not yet expired. */
  queue: GatePassView[];
  /** Both open return states, of ANY date — the predicates cut it, not this. */
  openReturns: GatePassView[];
  /** The material lines of `openReturns`, and ONLY on scope 'both'.
   *
   *  The dashboard's Returns Due Today and Overdue Returns figures count LINES,
   *  because the two pages they open list lines — the board's invariant is that
   *  a figure is `rows.length` of the array the page it opens renders, and a
   *  pass count beside a line list is exactly the kind of drift it forbids.
   *  The list pages do NOT take this read: Pending RGP Return loads one row's
   *  lines when that row is opened, and a bulk fetch would be a whole extra
   *  query for a table that shows none of it. */
  openItems: GatePassItemView[];
  loading: boolean;
  error: string | null;
  /** Re-read both queues without a skeleton. Recording a return has to move
   *  the list it was recorded from, and realtime is not guaranteed to be up on
   *  a gate terminal — an explicit refresh after the RPC resolves is what makes
   *  the row's new figures the database's, never the client's guess at them. */
  reload: () => void;
}

export function useGuardQueues(scope: GuardQueueScope = 'both'): GuardQueues {
  const [queue, setQueue] = useState<GatePassView[]>([]);
  const [openReturns, setOpenReturns] = useState<GatePassView[]>([]);
  const [openItems, setOpenItems] = useState<GatePassItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const base = () => gp().from('v_gate_passes').select('*');
        const nowIso = new Date().toISOString();

        const wantOut = scope !== 'returns';
        const wantReturns = scope !== 'out';

        const [queued, open] = await Promise.all([
          // The gate queue: both states the gate can still act on, and only
          // while the pass's own expiry has not passed. `is_expired` covers
          // `pending` alone; filtering `expires_at` covers both states
          // uniformly and never needs recomputing on the client.
          wantOut
            ? base()
                .in('status', ['pending', 'hod_reviewed'])
                .gte('expires_at', nowIso)
                .order('created_at', { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          // BOTH open return states, unfiltered by date. `partially_returned`
          // is not optional: the moment a guard records one line of a
          // three-line RGP, an `.eq('return_status','awaiting_return')` query
          // would drop the pass with two lines still outside.
          wantReturns
            ? base()
                .in('return_status', ['awaiting_return', 'partially_returned'])
                .order('expected_return_date', { ascending: true })
            : Promise.resolve({ data: [], error: null }),
        ]);

        for (const res of [queued, open]) {
          if (res.error) throw res.error;
        }

        setQueue((queued.data as GatePassView[] | null) ?? []);
        const openRows = (open.data as GatePassView[] | null) ?? [];
        setOpenReturns(openRows);
        setError(null);

        // Narrowed by the pass ids that survived the query above, so nothing
        // widens even if the view changes shape. A failed lines read leaves the
        // two line figures at zero rather than taking the whole board down with
        // it — the queue counts above are already on screen and still true.
        if (scope === 'both' && openRows.length > 0) {
          const itemRes = await gp()
            .from('v_gate_pass_items')
            .select('*')
            .in('gate_pass_id', openRows.map((p) => p.id))
            .order('line_no');
          setOpenItems(itemRes.error ? [] : ((itemRes.data as GatePassItemView[] | null) ?? []));
        } else {
          setOpenItems([]);
        }
      } catch (err) {
        setError(safeErrorMessage(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [scope]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: refresh silently so the numbers never flash a skeleton mid-shift.
  // Defensive because a partially-mocked client (tests) may not implement
  // `channel()`.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('guard-queues-gate-passes')
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

  const reload = useCallback(() => {
    void load(true);
  }, [load]);

  return { queue, openReturns, openItems, loading, error, reload };
}
