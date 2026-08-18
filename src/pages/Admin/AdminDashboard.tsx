// Admin Dashboard — the org-wide gate pass board.
//
// Rebuilt 2026-08-17 to the client's reference layout. This file is now DATA ONLY:
// the whole board lives in `src/components/board/GateBoard.tsx`, which the HOD
// dashboard renders too, so the two cannot drift apart in layout the way they did
// before.
//
// TWO reads, on mount: `v_gate_passes` and `v_gate_pass_items`. Every figure,
// ring, bar and list on the board comes out of those two arrays — the items only
// feed the two ranked panels (outstanding material, and today's top items).
//
// No aggregate query, deliberately. See the invariant in GateBoard.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassItemView, GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import GateBoard from '../../components/board/GateBoard';
import BoardDepartments from '../../components/board/BoardDepartments';

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
      // A board that refuses to render because ONE panel's query failed is worse
      // than a board with one empty panel: the items feed two ranked panels and
      // nothing else.
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
      // NO SUBTITLE (client, 2026-08-18). "Real-time overview of all material
      // gate pass activity" described the page; Today's Summary at the top of
      // the board states it instead, in five figures.
      rows={rows}
      items={items}
      loading={loading}
      error={error}
      registerTo="/all-passes"
      onRefresh={() => void load()}
      /* Admin only (client, 2026-08-18): an HOD's board is one department, so
         the same ranking there would be one column. */
      footer={<div className="mt-6"><BoardDepartments rows={rows} loading={loading} /></div>}
    />
  );
}
