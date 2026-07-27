// The guard's landing page — the most important screen in the app.
// Lookup box first (a guard should never scroll a list to find the truck in
// front of them), then KPIs, then the pending queue as premium cards, oldest first.
// Each KPI card links to a filtered view; queue cards use colour, badges and
// typographic hierarchy so a glance tells you which truck has been waiting longest.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase, gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { PASS_CATEGORY_LIST, PASS_CATEGORIES, categoryKey, type PassCategoryKey } from '../../lib/passTypes';
import { TypeChip } from '../../components/Badge';
import KpiCard from '../../components/KpiCard';
import { formatTime } from '../../lib/formatDate';
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

/** RGP-type passes get a cyan left border; NRGP gets slate. */
function typeBorder(type: string): string {
  return type === 'RGP' ? 'border-l-brand-500' : 'border-l-navy-400';
}

/** Waiting-time badge with overdue colour when >2h. */
function waitBadge(createdAt: string): { text: string; cls: string } {
  const ms = Date.now() - new Date(createdAt).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const text = h > 0 ? `${h}h ${m}m` : `${m}m`;
  const overdue = ms > TWO_HOURS_MS;
  const cls = overdue
    ? 'bg-overdue-100 text-overdue-700 border border-overdue-300'
    : 'bg-surface-100 text-navy-500 border border-surface-300';
  return { text, cls };
}

export default function GateConsole(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const queueRef = useRef<HTMLDivElement>(null);

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
  // the queue update in place without flashing skeletons.
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

  // Scroll to queue section if URL hash is #queue (KPI "Queue Size" / "Oldest Wait" clicks).
  useEffect(() => {
    if (location.hash === '#queue' && queueRef.current) {
      queueRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [location.hash, loading]);

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

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <KpiCard label="Pending Now" value={pendingCount} tone="pending" to="/console#queue" loading={loading} />
        <KpiCard label="Queue Size" value={queue.length} tone="pending" to="/console#queue" loading={loading} />
        <KpiCard label="Oldest Wait" value={oldestWaitValue} tone={oldestWaitTone} to="/console#queue" loading={loading} />
        <KpiCard label="Matched Today" value={matchedToday} tone="matched" to="/history?status=matched" loading={loading} />
        <KpiCard label="Flagged Today" value={flaggedToday} tone="flagged" to="/history?status=flagged" loading={loading} />
      </div>

      <div ref={queueRef} id="queue" className="flex flex-wrap gap-3 items-center mb-5">
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

        <span className="text-xs text-navy-400 ml-auto tabular">
          {filteredQueue.length} of {queue.length} showing
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-44 w-full" />
          ))}
        </div>
      ) : filteredQueue.length === 0 ? (
        <div className="card empty-state">
          <p>Queue clear — nothing waiting at the gate.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredQueue.map((p, idx) => {
            const wb = waitBadge(p.created_at);
            const isOldest = idx === 0;
            return (
              <Link
                key={p.id}
                to={`/verify/${p.id}`}
                className={`card-hover flex flex-col gap-3 p-5 border-l-4 ${typeBorder(p.type)}
                  ${isOldest ? 'ring-1 ring-brand-500/30' : ''}`}
              >
                {/* Row 1: pass number + type chip + wait badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-bold text-navy-950 text-base font-display truncate">{p.pass_number}</span>
                    {isOldest && (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded animate-pulse-soft">
                        Oldest
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full tabular ${wb.cls}`}>
                      {wb.text}
                    </span>
                    <TypeChip type={p.type} direction={p.direction} />
                  </div>
                </div>

                {/* Row 2: visitor name + company */}
                <div className="flex items-center flex-wrap gap-1.5">
                  <span className="font-semibold text-navy-900 text-sm">{p.visitor_name}</span>
                  {p.visitor_company && (
                    <span className="text-[11px] font-medium text-brand-700 bg-brand-50 border border-brand-200 px-2 py-0.5 rounded-full truncate max-w-[200px]">
                      {p.visitor_company}
                    </span>
                  )}
                </div>

                {/* Row 3: material summary */}
                {p.material_summary && (
                  <p className="text-sm text-navy-600 leading-snug line-clamp-2">{p.material_summary}</p>
                )}

                {/* Row 4: item count, vehicle, department, return status */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
                  <span className="inline-flex items-center gap-1 font-semibold text-matched-700 bg-matched-50 px-2 py-0.5 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    {p.item_count} item{p.item_count !== 1 ? 's' : ''}
                  </span>

                  {p.vehicle_number && (
                    <span className="inline-flex items-center gap-1 text-navy-500 bg-surface-100 px-2 py-0.5 rounded-full">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                      {p.vehicle_number}
                    </span>
                  )}

                  <span className="inline-flex items-center gap-1 text-navy-500 bg-surface-100 px-2 py-0.5 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    {p.department_code || p.department_name}
                  </span>

                  {p.type === 'RGP' && p.return_status !== 'not_applicable' && (
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium
                      ${p.is_overdue
                        ? 'bg-overdue-100 text-overdue-700 border border-overdue-300'
                        : 'bg-brand-50 text-brand-700 border border-brand-200'}`}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {p.is_overdue ? 'Overdue' : p.return_status === 'awaiting_return' ? 'Awaiting Return' : p.return_status === 'returned' ? 'Returned' : ''}
                    </span>
                  )}
                </div>

                {/* Row 5: raised at + raised by */}
                <div className="flex items-center gap-2 text-[11px] text-navy-400">
                  <span>Raised {formatTime(p.created_at)}</span>
                  <span className="w-1 h-1 rounded-full bg-navy-300" />
                  <span>{p.raised_by_name}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
