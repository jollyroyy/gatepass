// Admin Dashboard — the org-wide gate pass board.
//
// Rebuilt 2026-08-17 to the client's reference layout. This file is now DATA ONLY:
// the whole board lives in `src/components/board/GateBoard.tsx`, which the HOD
// dashboard renders too, so the two cannot drift apart in layout the way they did
// before.
//
// ONE read, on mount: `v_gate_passes`. Every figure, ring and list on the board
// comes out of that single array.
//
// The board used to also read `v_gate_pass_items`, for the outstanding-material
// ranking. That panel went when the board was cut back to today only
// (2026-08-17), and the query went with it rather than being left fetching rows
// nothing renders.
//
// No aggregate query, deliberately. See the invariant in GateBoard.tsx.
import React, { useCallback, useEffect, useState } from 'react';
import { gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import GateBoard from '../../components/board/GateBoard';

export default function AdminDashboard(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Cleared UP FRONT, never on the success path: a refresh that resolves in the
    // same microtask queue as a failed action would otherwise wipe the banner
    // before it ever rendered (the 2026-08-13 BlacklistTab bug).
    setError(null);
    try {
      const passRes = await gp().from('v_gate_passes').select('*');
      if (passRes.error) throw passRes.error;
      setRows((passRes.data as GatePassView[] | null) ?? []);
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
      title="Today's Gate Pass Summary"
      subtitle="Material gate pass activity across the site today."
      rows={rows}
      loading={loading}
      error={error}
      registerTo="/all-passes"
      onRefresh={() => void load()}
    />
  );
}
