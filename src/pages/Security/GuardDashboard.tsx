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
import { DRILL_DEFS, DRILL_ORDER, type DrillKey } from '../../lib/guardDrills';
import { todayBounds } from '../../lib/hodKpis';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import GuardDrillCard from './GuardDrillCard';

type DrillRows = Record<DrillKey, GatePassView[]>;
type DaySets = {
  raisedToday: GatePassView[];
  verifiedToday: GatePassView[];
  /** Every pass currently awaiting_return, with NO date filter — see the
   *  reasoning in guardDrills.ts. Powers Awaiting Return and Overdue. */
  openObligations: GatePassView[];
};

const EMPTY_SETS: DaySets = { raisedToday: [], verifiedToday: [], openObligations: [] };

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
      // Three queries, not eight. Every drill is a client-side filter of one
      // of them, so the board resets at local midnight by construction — with
      // the deliberate exception of `openObligations`, which carries no date
      // filter at all (see guardDrills.ts for why Awaiting Return / Overdue
      // must not be today-scoped).
      const { start, end } = todayBounds();
      const startIso = new Date(start).toISOString();
      const endIso = new Date(end).toISOString();
      const base = () => gp().from('v_gate_passes').select('*');
      const [raised, verified, open] = await Promise.all([
        base().gte('created_at', startIso).lt('created_at', endIso).order('created_at', { ascending: true }),
        base().gte('verified_at', startIso).lt('verified_at', endIso).order('verified_at', { ascending: false }),
        base().eq('return_status', 'awaiting_return').order('created_at', { ascending: true }),
      ]);

      for (const res of [raised, verified, open]) {
        if (res.error) throw res.error;
      }

      setSets({
        raisedToday: (raised.data as GatePassView[] | null) ?? [],
        verifiedToday: (verified.data as GatePassView[] | null) ?? [],
        openObligations: (open.data as GatePassView[] | null) ?? [],
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

  // One line came back. `apply_item_returns` may have closed the whole pass in
  // the same statement — re-read rather than infer it here, so the KPI counts
  // and the pass's own status come from the database's decision, not ours.
  // Silent: a guard mid-return must not see the list flash out from under them.
  const handleItemReturned = useCallback(() => {
    void load(true);
  }, [load]);

  const rows = buildRows(sets);
  const def = DRILL_DEFS[selected];
  const list = rows[selected];
  const resultsRef = useScrollIntoViewOnChange<HTMLDivElement>(selected);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">
          <span className="font-semibold text-navy-700">Showing today</span> — every figure
          resets at midnight, except Awaiting Return and Overdue, which stay open until the
          material actually comes back. Tap one to see the passes behind it. Historical
          passes of any date live in Reports.
        </p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {/* Zero-count renders nothing. Reads the same `rows.expired` array the
          Expired KPI card counts, so the two can never disagree. */}
      {rows.expired.length > 0 && (
        <div className="bg-flagged-500/10 border-l-4 border-flagged-500 rounded-r-lg px-4 py-3 mb-6">
          <p className="text-sm font-semibold text-flagged-700">
            {rows.expired.length} {rows.expired.length === 1 ? 'pass' : 'passes'} expired without reaching the
            gate today.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {DRILL_ORDER.map((key) => (
          <KpiCard
            key={key}
            label={DRILL_DEFS[key].label}
            value={rows[key].length}
            tone={DRILL_DEFS[key].tone}
            delta={DRILL_DEFS[key].allTime ? 'all time' : undefined}
            loading={loading}
            active={key === selected}
            onClick={() => setSelected(key)}
          />
        ))}
      </div>

      <div ref={resultsRef}>
        <div className="flex items-baseline gap-3 mb-4">
          <h2 className="section-title mb-0">{def.heading}</h2>
          <span className="text-xs font-medium text-navy-500 tabular">
            {list.length} {list.length === 1 ? 'pass' : 'passes'}
          </span>
        </div>

        {actionError && <div className="alert-error mb-4">{actionError}</div>}

        {loading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton h-40 w-full" />
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="card empty-state">
            <p>{def.empty}</p>
          </div>
        ) : (
          // Full-width stacked rows, never a 2/3-up grid — the client asked
          // for a KPI drill to scan top-to-bottom like a list, not a mosaic.
          <div className="flex flex-col gap-4 w-full">
            {list.map((p) => (
              <GuardDrillCard
                key={p.id}
                pass={p}
                returnable={def.returnable}
                onMarkReturned={handleMarkReturned}
                onItemReturned={handleItemReturned}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
