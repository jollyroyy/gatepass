// The three reads behind the Activity Log, and nothing else.
//
// THREE QUERIES, NO AGGREGATES. Same rule every board in this app follows: the
// screen renders exactly the rows these return, so a count and its list cannot
// disagree. There is no `count: 'exact'` here and no summary endpoint.
//
// THE WINDOW IS THE FIRST QUERY'S. Passes are fetched for the chosen number of
// days, and the other two are narrowed to THOSE pass ids — so an approval that
// happened today on a pass raised two months ago is outside the window. That is
// a real limitation and it is deliberate: the alternative is scanning every
// approval row in the database on every page load to find the handful whose
// parent is old. The window is adjustable on screen, which is the escape hatch.
//
// NAMES COME FROM THE DIRECTORY, not from a join. `pass_approvals.decided_by`
// is a uuid; `get_pass_approvals()` joins the name on but answers for ONE pass.
// An admin can already read the directory, so one extra read maps every id at
// once — and 006's rule stands, because `fetchDirectory` goes through the same
// helper every other admin screen uses.
import { useCallback, useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import { fetchDirectory } from './profiles';
import type { GatePassView } from '../types';
import { buildActivityLog, type ActivityLogEntry, type ApprovalEvent, type GateEvent } from './activityLog';

export interface UseActivityLog {
  rows: ActivityLogEntry[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Local midnight, `days` ago. Local and not UTC because the window a person
 *  picks is in the days they live in. */
function since(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - (days - 1));
  return d.toISOString();
}

export function useActivityLog(days: number): UseActivityLog {
  const [rows, setRows] = useState<ActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: passData, error: passErr } = await gp()
          .from('v_gate_passes')
          .select('*')
          .gte('created_at', since(days))
          .order('created_at', { ascending: false });
        if (passErr) throw passErr;
        const passes = (passData as GatePassView[] | null) ?? [];
        const ids = passes.map((p) => p.id);

        // An empty window means two queries with an empty `in` list, which
        // PostgREST is entitled to treat oddly. Skip them and say so with an
        // empty log rather than a failed one.
        const [approvals, gateEvents, directory] = ids.length
          ? await Promise.all([
              gp().from('pass_approvals').select('*').in('gate_pass_id', ids),
              gp().from('v_verifications').select('*').in('gate_pass_id', ids),
              fetchDirectory(),
            ])
          : [{ data: [] }, { data: [] }, []];

        if (cancelled) return;
        const names = new Map(
          (directory as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
        );
        setRows(
          buildActivityLog(
            passes,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((approvals as any).data as ApprovalEvent[] | null) ?? [],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ((gateEvents as any).data as GateEvent[] | null) ?? [],
            names,
          ),
        );
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read the activity log.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days, nonce]);

  return { rows, loading, error, reload };
}
