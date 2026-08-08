// The guard's Pending Returns tab — everything that has left the gate and has
// not fully come back, AT A GLANCE, on its own left-sidebar tab.
//
// Re-added 2026-08-08 per operator request: the closing action used to live
// only on dashboard KPI drills (Awaiting Return / Overdue), so a guard had to
// know to click across to find what was still out. This page lists BOTH open
// return states — `awaiting_return` AND `partially_returned` — with NO date
// filter: material that left last week is more urgent today, not less.
//
// Each pass is a returnable GuardDrillCard, so per-line returns and Return All
// are reachable from the exact list a guard is looking at. The pass closes
// itself in the database (apply_item_returns rolls lines up); this page only
// re-reads. A fully-returned pass never appears here — two queries prove it:
// the view returns it as `returned`, and this query does not ask for that.
import React, { useCallback, useEffect, useState } from 'react';
import { gp, supabase } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import GuardDrillCard from './GuardDrillCard';

export default function PendingReturns(): React.ReactElement {
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Only the two open return states; `returned` (and `not_applicable`
      // NRGP rows) never come back here. Overdue material leads, then the
      // soonest expected return — what a guard actually wants to read.
      const { data, error: err } = await gp()
        .from('v_gate_passes')
        .select('*')
        .in('return_status', ['awaiting_return', 'partially_returned'])
        .order('is_overdue', { ascending: false })
        .order('expected_return_date', { ascending: true, nullsFirst: false });
      if (err) throw err;
      setRows((data as GatePassView[] | null) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: a return recorded elsewhere (or a new pass matched) updates the
  // list silently — no skeleton flash while someone is looking at it.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('pending-returns-gate-passes')
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

  const handleMarkReturned = useCallback(
    async (pass: GatePassView, remarks: string) => {
      setActionError(null);
      try {
        const { error: rpcErr } = await gp().rpc('mark_returned', {
          p_pass_id: pass.id,
          p_remarks: remarks.trim() || null,
        });
        if (rpcErr) throw rpcErr;
        await load(true);
      } catch (err) {
        setActionError(safeErrorMessage(err));
      }
    },
    [load],
  );

  // One line came back. `apply_item_returns` may have closed the whole pass in
  // the same statement — re-read rather than infer it here, so the card list
  // reflects the database's decision, not ours.
  const handleItemReturned = useCallback(() => {
    void load(true);
  }, [load]);

  const overdue = rows.filter((p) => p.is_overdue).length;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Pending Returns</h1>
        <p className="page-subtitle">
          Material that has left the gate and has not fully come back — at a glance, all-time,
          no date filter. Overdue material leads the list. Record a return and the pass leaves
          this page the moment the database closes it.
        </p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {/* The count IS the list below it — same array, so the two can never
          disagree. */}
      {!loading && rows.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-6">
          <span className="type-chip">
            {rows.length} {rows.length === 1 ? 'pass' : 'passes'} still {rows.length === 1 ? 'is' : 'are'} out
          </span>
          {overdue > 0 && (
            <span className="type-chip bg-overdue-100 text-overdue-700 border-overdue-300">
              {overdue} overdue
            </span>
          )}
        </div>
      )}

      {actionError && <div className="alert-error mb-4">{actionError}</div>}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-64 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="card empty-state">
          <p>Nothing is out right now. Every returnable pass has come back.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {rows.map((p) => (
            <GuardDrillCard
              key={p.id}
              pass={p}
              returnable
              onMarkReturned={handleMarkReturned}
              onItemReturned={handleItemReturned}
            />
          ))}
        </div>
      )}
    </div>
  );
}