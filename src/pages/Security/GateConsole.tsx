// The guard's landing page — the most important screen in the app.
// Lookup box first (a guard should never scroll a list to find the truck in
// front of them), then KPIs, then the pending queue as cards, oldest first.
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase, gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { PASS_CATEGORY_LIST, PASS_CATEGORIES, categoryKey, type PassCategoryKey } from '../../lib/passTypes';
import { TypeChip } from '../../components/Badge';
import KpiCard from '../../components/KpiCard';
import { relativeAge } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import GateLookup from './GateLookup';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

interface DeptOption {
  id: string;
  name: string;
}

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatAge(createdAt: string): string {
  const ms = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function GateConsole(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();

  // Captured once at mount from history state; never updated afterwards.
  const [flash] = useState<string | null>(
    (location.state as { flash?: string } | null)?.flash ?? null
  );

  // Clear the flash from history state once shown, so a refresh or back-nav
  // does not replay it.
  useEffect(() => {
    if (flash) navigate(location.pathname, { replace: true, state: {} });
    // Intentionally runs once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [matchedToday, setMatchedToday] = useState(0);
  const [flaggedToday, setFlaggedToday] = useState(0);
  const [queue, setQueue] = useState<GatePassView[]>([]);

  const [categoryFilter, setCategoryFilter] = useState<PassCategoryKey | 'all'>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const todayIso = startOfTodayIso();
      const [kpiRes, matchedRes, flaggedRes, queueRes] = await Promise.all([
        gp().rpc('kpis', { p_department_id: null }),
        gp()
          .from('v_gate_passes')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'matched')
          .gte('verified_at', todayIso),
        gp()
          .from('v_gate_passes')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'flagged')
          .gte('verified_at', todayIso),
        gp().from('v_gate_passes').select('*').eq('status', 'pending').order('created_at', { ascending: true }),
      ]);

      if (kpiRes.error) throw kpiRes.error;
      if (matchedRes.error) throw matchedRes.error;
      if (flaggedRes.error) throw flaggedRes.error;
      if (queueRes.error) throw queueRes.error;

      const kpiRow = (kpiRes.data as { pending: number }[] | null)?.[0];
      setPendingCount(kpiRow?.pending ?? 0);
      setMatchedToday(matchedRes.count ?? 0);
      setFlaggedToday(flaggedRes.count ?? 0);
      setQueue((queueRes.data as GatePassView[] | null) ?? []);
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

  // Realtime: any change to gate_passes triggers a silent re-load, so KPIs and
  // the queue update in place without flashing skeletons. Defensive because a
  // partially-mocked supabase client (tests) may not implement `channel()`.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('gate-console-gate-passes')
        .on('postgres_changes', { event: '*', schema: 'gatepass', table: 'gate_passes' }, () => {
          load(true);
        })
        .subscribe();
    } catch {
      // No realtime available — the page still works via the initial load.
    }
    return () => {
      try {
        if (ch) supabase.removeChannel(ch);
      } catch {
        // ignore cleanup failures
      }
    };
  }, [load]);

  const deptOptions: DeptOption[] = Array.from(
    new Map(queue.map((p) => [p.department_id, { id: p.department_id, name: p.department_name }])).values()
  );

  const filteredQueue = queue.filter((p) => {
    if (categoryFilter !== 'all' && categoryKey(p.type, p.direction) !== categoryFilter) return false;
    if (deptFilter !== 'all' && p.department_id !== deptFilter) return false;
    return true;
  });

  const oldestWaitMs = queue.length > 0 ? Date.now() - new Date(queue[0].created_at).getTime() : 0;
  const oldestWaitValue = queue.length > 0 ? formatAge(queue[0].created_at) : '—';
  const oldestWaitTone: 'overdue' | 'pending' = oldestWaitMs > TWO_HOURS_MS ? 'overdue' : 'pending';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Gate Console</h1>
        <p className="page-subtitle">Look up a pass, or work the pending queue below.</p>
      </div>

      {flash && <div className="alert-success mb-6">{flash}</div>}

      <GateLookup />

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 mb-8">
        <KpiCard label="Pending Now" value={pendingCount} tone="pending" loading={loading} />
        <KpiCard label="Queue Size" value={queue.length} tone="pending" loading={loading} />
        <KpiCard label="Oldest Wait" value={oldestWaitValue} tone={oldestWaitTone} loading={loading} />
        <KpiCard label="Matched Today" value={matchedToday} tone="matched" loading={loading} />
        <KpiCard label="Flagged Today" value={flaggedToday} tone="flagged" loading={loading} />
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-5">
        <select
          className="input w-auto"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value as PassCategoryKey | 'all')}
        >
          <option value="all">All Types</option>
          {PASS_CATEGORY_LIST.map((k) => (
            <option key={k} value={k}>
              {PASS_CATEGORIES[k].label}
            </option>
          ))}
        </select>

        {deptOptions.length > 1 && (
          <select className="input w-auto" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="all">All Departments</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-40 w-full" />
          ))}
        </div>
      ) : filteredQueue.length === 0 ? (
        <div className="card empty-state">
          <p>Queue clear — nothing waiting at the gate.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredQueue.map((p) => {
            const waitingLong = Date.now() - new Date(p.created_at).getTime() > TWO_HOURS_MS;
            return (
              <Link
                key={p.id}
                to={`/verify/${p.id}`}
                className={`card-hover p-5 flex flex-col gap-2 ${waitingLong ? 'border-pending-500/40' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-navy-950 text-lg">{p.pass_number}</span>
                  <TypeChip type={p.type} direction={p.direction} />
                </div>
                <p className="text-sm text-navy-700">
                  <span className="font-semibold">{p.visitor_name}</span>
                  {p.visitor_company && <span className="text-navy-400"> · {p.visitor_company}</span>}
                </p>
                <p className="text-sm text-navy-600 truncate">{p.material_summary ?? ''}</p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-navy-500">
                  <span className="tabular">
                    {p.item_count} item(s)
                  </span>
                  <span>{p.vehicle_number ?? 'No vehicle'}</span>
                  <span>{p.department_name}</span>
                </div>
                <span
                  className={`text-xs font-semibold mt-1 ${waitingLong ? 'text-pending-700' : 'text-navy-400'}`}
                >
                  Waiting {relativeAge(p.created_at)}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
