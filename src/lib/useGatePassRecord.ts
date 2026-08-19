// Loads one whole gate-pass record — the pass row, its material lines and its
// verification trail — for the Search Pass result view.
//
// Three reads of three views, never a client-side join: `v_gate_passes`,
// `v_gate_pass_items` and `v_verifications` each apply RLS on their own, and
// "nothing came back" is a legitimate answer meaning no access / not found.
//
// `undefined` = still loading, `null` = nothing to show. They are deliberately
// different states: collapsing them makes a slow network render "not found".
import { useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import type { GatePassItemView, GatePassView } from '../types';
import type { ActivityEntry } from '../components/passview/PassTimeline';
import { safeErrorMessage } from './errors';

export interface GatePassRecord {
  pass: GatePassView;
  items: GatePassItemView[];
  activity: ActivityEntry[];
}

/** `reloadKey` re-runs the three reads without changing the pass: the detail
 *  page bumps it after an HOD override, which rewrites `status` server-side. */
export function useGatePassRecord(passId: string | null, reloadKey = 0): {
  record: GatePassRecord | null | undefined;
  error: string | null;
} {
  const [record, setRecord] = useState<GatePassRecord | null | undefined>(passId ? undefined : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passId) {
      setRecord(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setRecord(undefined);
    setError(null);

    (async () => {
      try {
        const passRes = await gp().from('v_gate_passes').select('*').eq('id', passId).maybeSingle();
        if (passRes.error) throw passRes.error;
        const pass = (passRes.data as GatePassView | null) ?? null;
        if (cancelled) return;
        if (!pass) {
          setRecord(null);
          return;
        }

        const itemsRes = await gp()
          .from('v_gate_pass_items')
          .select('*')
          .eq('gate_pass_id', passId)
          .order('line_no');
        if (itemsRes.error) throw itemsRes.error;

        const verifRes = await gp()
          .from('v_verifications')
          .select('*')
          .eq('gate_pass_id', passId)
          .order('created_at');
        if (verifRes.error) throw verifRes.error;

        if (cancelled) return;
        setRecord({
          pass,
          items: (itemsRes.data as GatePassItemView[] | null) ?? [],
          activity: (verifRes.data as ActivityEntry[] | null) ?? [],
        });
      } catch (err) {
        if (!cancelled) {
          setError(safeErrorMessage(err));
          setRecord(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [passId, reloadKey]);

  return { record, error };
}
