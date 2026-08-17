// Admin Dashboard — the org-wide gate pass board.
//
// Rebuilt 2026-08-17 to the client's reference layout. This file is now DATA ONLY:
// the whole board lives in `src/components/board/GateBoard.tsx`, which the HOD
// dashboard renders too, so the two cannot drift apart in layout the way they did
// before.
//
// Two reads, both on mount:
//   v_gate_passes      — every figure, chart and list on the board.
//   v_gate_pass_items  — the outstanding-material ranking only. An admin passes
//                        `is_security()`, so `gate_pass_items_select` (013) shows
//                        them every line org-wide, the same scope they already
//                        have on the passes themselves.
//
// No aggregate query, deliberately. See the invariant in GateBoard.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView, GatePassItemView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import GateBoard from '../../components/board/GateBoard';

export default function AdminDashboard(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [items, setItems] = useState<GatePassItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Cleared UP FRONT, never on the success path: a refresh that resolves in the
    // same microtask queue as a failed action would otherwise wipe the banner
    // before it ever rendered (the 2026-08-13 BlacklistTab bug).
    setError(null);
    try {
      const [passRes, itemRes] = await Promise.all([
        gp().from('v_gate_passes').select('*'),
        gp().from('v_gate_pass_items').select('*'),
      ]);
      if (passRes.error) throw passRes.error;
      setRows((passRes.data as GatePassView[] | null) ?? []);
      // The material ranking is the only consumer, and a board that refuses to
      // render because ONE panel's query failed is worse than a board with one
      // empty panel. Items failing is therefore not fatal.
      setItems(itemRes.error ? [] : ((itemRes.data as GatePassItemView[] | null) ?? []));
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <GateBoard
      title="Gate Pass Management Dashboard"
      subtitle="Live overview of all material gate pass activity, org-wide."
      rows={rows}
      items={items}
      loading={loading}
      error={error}
      registerTo="/all-passes"
      outstandingMode="department"
      onRefresh={() => void load()}
    />
  );
}
