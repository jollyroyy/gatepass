// The guard's Dashboard — every number the gate cares about, and each one is a
// drill: click a KPI and the passes behind it open as premium cards below,
// on this same page. No navigation, because a guard is standing at a barrier.
//
// It absorbed the old Pending Returns page (Awaiting Return + Overdue), so the
// Mark Returned action lives on the drill cards now — see GuardDrillCard.
import React, { useCallback, useEffect, useState } from 'react';
import { gp, supabase } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import KpiCard from '../../components/KpiCard';
import { safeErrorMessage } from '../../lib/errors';
import { DRILL_DEFS, DRILL_ORDER, startOfTodayIso, type DrillKey } from '../../lib/guardDrills';
import GuardDrillCard from './GuardDrillCard';

type DrillRows = Record<DrillKey, GatePassView[]>;
type DaySets = { raisedToday: GatePassView[]; verifiedToday: GatePassView[] };

const EMPTY_SETS: DaySets = { raisedToday: [], verifiedToday: [] };

/** One pass through each day set, filtered by each drill's own predicate. The
 *  card's number and the card list it opens are therefore the same array. */
function buildRows(sets: DaySets): DrillRows {
  const out = {} as DrillRows;
  for (const key of DRILL_ORDER) {
    const def = DRILL_DEFS[key];
    out[key] = sets[def.source].filter(def.match);
  }
  return out;
}

export default function GuardDashboard(): React.ReactElement {
  const [sets, setSets] = useState<DaySets>(EMPTY_SETS);
  const [selected, setSelected] = useState<DrillKey>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Two day-scoped queries, not eight. Every drill is a client-side filter
      // of one of them, so the board resets at local midnight by construction.
      const today = startOfTodayIso();
      const base = () => gp().from('v_gate_passes').select('*');
      const [raised, verified] = await Promise.all([
        base().gte('created_at', today).order('created_at', { ascending: true }),
        base().gte('verified_at', today).order('verified_at', { ascending: false }),
      ]);

      for (const res of [raised, verified]) {
        if (res.error) throw res.error;
      }

      setSets({
        raisedToday: (raised.data as GatePassView[] | null) ?? [],
        verifiedToday: (verified.data as GatePassView[] | null) ?? [],
      });
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: refresh silently so the numbers never flash a skeleton mid-shift.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('guard-dashboard-gate-passes')
        .on('postgres_changes', { event: '*', schema: 'gatepass', table: 'gate_passes' }, () => {
          load(true);
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

  const rows = buildRows(sets);
  const def = DRILL_DEFS[selected];
  const list = rows[selected];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          Today only — every figure resets at midnight. Tap one to see the passes behind it.
        </p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {DRILL_ORDER.map((key) => (
          <KpiCard
            key={key}
            label={DRILL_DEFS[key].label}
            value={rows[key].length}
            tone={DRILL_DEFS[key].tone}
            loading={loading}
            active={key === selected}
            onClick={() => setSelected(key)}
          />
        ))}
      </div>

      <div className="flex items-baseline gap-3 mb-4">
        <h2 className="section-title mb-0">{def.heading}</h2>
        <span className="text-xs font-medium text-navy-400 tabular">
          {list.length} {list.length === 1 ? 'pass' : 'passes'}
        </span>
      </div>

      {actionError && <div className="alert-error mb-4">{actionError}</div>}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-64 w-full" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="card empty-state">
          <p>{def.empty}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {list.map((p) => (
            <GuardDrillCard
              key={p.id}
              pass={p}
              returnable={def.returnable}
              onMarkReturned={handleMarkReturned}
            />
          ))}
        </div>
      )}
    </div>
  );
}
