// The material lines of ONE pass, loaded when the reader opens a row.
//
// Deliberately on demand rather than with the list: the Pending OUT page holds
// a hundred passes and nobody reads a hundred item tables. One row is open at a
// time, so this is one small read per disclosure, and closing the row throws
// the rows away rather than caching a set that `apply_item_returns` could
// invalidate underneath it.
//
// `undefined` = loading, `[]` = a real answer (no lines / no access). They are
// deliberately different states, the same rule `useGatePassRecord` follows.
import { useEffect, useState } from 'react';
import { gp } from '../supabaseClient';
import type { GatePassItemView } from '../types';
import { safeErrorMessage } from './errors';

export function usePassItems(passId: string | null): {
  items: GatePassItemView[] | undefined;
  error: string | null;
} {
  const [items, setItems] = useState<GatePassItemView[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passId) {
      setItems(undefined);
      setError(null);
      return;
    }
    let cancelled = false;
    setItems(undefined);
    setError(null);

    void (async () => {
      try {
        const res = await gp()
          .from('v_gate_pass_items')
          .select('*')
          .eq('gate_pass_id', passId)
          .order('line_no');
        if (res.error) throw res.error;
        if (cancelled) return;
        setItems((res.data as GatePassItemView[] | null) ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(safeErrorMessage(err));
        setItems([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [passId]);

  return { items, error };
}
