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
      subtitle="Real-time overview of all material gate pass activity."
      rows={rows}
      items={items}
      loading={loading}
      error={error}
      registerTo="/all-passes"
      // NO `outstandingMode` AND NO QUICK SUMMARY (client, 2026-08-18). Omitting
      // the mode is what drops the "material still out — top 5" ranking; the
      // summary row was five restatements of the two category rows above it.
      // Neither fact is lost: Return Watch still breaks the open obligations
      // down, and RGP Currently Outside is a tile.
      showSummary={false}
      onRefresh={() => void load()}
    />
  );
}
