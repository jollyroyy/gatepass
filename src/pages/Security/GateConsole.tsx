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
  const [mismatchedToday, setMismatchedToday] = useState(0);
  const [queue, setQueue] = useState<GatePassView[]>([]);

  const [categoryFilter, setCategoryFilter] = useState<PassCategoryKey | 'all'>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const todayIso = startOfTodayIso();
      const [kpiRes, matchedRes, mismatchedRes, queueRes] = await Promise.all([
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
      if (mismatchedRes.error) throw mismatchedRes.error;
      if (queueRes.error) throw queueRes.error;

      const kpiRow = (kpiRes.data as { pending: number }[] | null)?.[0];
      setPendingCount(kpiRow?.pending ?? 0);
      setMatchedToday(matchedRes.count ?? 0);
      setMismatchedToday(mismatchedRes.count ?? 0);
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
    if (categoryFilter !== 'all' && categoryKey(p.type) !== categoryFilter) return false;
    if (deptFilter !== 'all' && p.department_id !== deptFilter) return false;
    return true;
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Gate Console</h1>
        <p className="page-subtitle">Look up a pass, or work the pending queue below.</p>
      </div>

      {flash && <div className="alert-success mb-6">{flash}</div>}

      <GateLookup />

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        <KpiCard label="Pending for Gate Approval" value={pendingCount} tone="pending" to="/console#queue" loading={loading} />
        <KpiCard label="Matched at Gate" value={matchedToday} tone="matched" to="/history?status=matched" loading={loading} />
        <KpiCard label="Mismatch at Gate" value={mismatchedToday} tone="flagged" to="/history?status=flagged" loading={loading} />
      </div>

      <div ref={queueRef} id="queue" className="mb-5">
        <div className="inline-flex items-center gap-2 bg-surface-100/60 border border-surface-200 rounded-xl px-3 py-2 backdrop-blur-sm">
          <svg className="w-4 h-4 text-navy-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
          <select
            className="text-sm font-medium bg-transparent border-0 p-0 pr-6 text-navy-700 cursor-pointer focus:ring-0 appearance-none"
            style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right center" }}
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

          <span className="w-px h-5 bg-surface-300" />

          {deptOptions.length > 1 ? (
            <select
              className="text-sm font-medium bg-transparent border-0 p-0 pr-6 text-navy-700 cursor-pointer focus:ring-0 appearance-none"
              style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")", backgroundRepeat: "no-repeat", backgroundPosition: "right center" }}
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="all">All Departments</option>
              {deptOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm font-medium text-navy-500">{deptOptions[0]?.name ?? ''}</span>
          )}

          <span className="w-px h-5 bg-surface-300" />

          <span className="text-xs font-medium text-navy-400 tabular whitespace-nowrap">
            {filteredQueue.length}<span className="text-navy-300 mx-0.5">/</span>{queue.length}
          </span>
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {filteredQueue.map((p, idx) => {
            const wb = waitBadge(p.created_at);
            const isOldest = idx === 0;
            return (
              <Link
                key={p.id}
                to={`/verify/${p.id}`}
                className={`group relative flex flex-col gap-4 p-5 rounded-2xl transition-all duration-300
                  ${isOldest ? 'ring-1 ring-brand-500/40' : ''}`}
                style={{
                  background: 'rgb(var(--glass-bg) / 0.45)',
                  backdropFilter: 'blur(24px) saturate(160%)',
                  WebkitBackdropFilter: 'blur(24px) saturate(160%)',
                  border: '1px solid rgb(var(--c-surface-200) / 0.5)',
                  boxShadow: '0 8px 32px -8px rgb(15 23 42 / 0.08), 0 2px 8px -2px rgb(15 23 42 / 0.04)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgb(var(--c-brand-400) / 0.5)';
                  e.currentTarget.style.transform = 'translateY(-3px)';
                  e.currentTarget.style.boxShadow = '0 20px 48px -12px rgb(15 23 42 / 0.14), 0 4px 16px -4px rgb(198 161 91 / 0.12)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'rgb(var(--c-surface-200) / 0.5)';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 8px 32px -8px rgb(15 23 42 / 0.08), 0 2px 8px -2px rgb(15 23 42 / 0.04)';
                }}
              >
                {/* Top bar: type chip + wait time + oldest badge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <TypeChip type={p.type} />
                    {isOldest && (
                      <span className="text-[10px] font-bold uppercase tracking-widest text-brand-600 bg-brand-50/70 px-2 py-0.5 rounded-full animate-pulse-soft">
                        Oldest
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full tabular ${wb.cls}`}>
                    {wb.text}
                  </span>
                </div>

                {/* Pass number */}
                <div className="flex items-center justify-between gap-3">
                  <span className="font-bold text-navy-950 text-lg font-display tracking-tight truncate">{p.pass_number}</span>
                  <svg className="w-5 h-5 text-navy-300 group-hover:text-brand-500 transition-colors duration-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </div>

                {/* Two-column detail grid */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">Company</p>
                    <p className="text-sm font-semibold text-brand-700 truncate">{p.visitor_company || '—'}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">Visitor</p>
                    <p className="text-sm font-medium text-navy-800 truncate">{p.visitor_name}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">Department</p>
                    <p className="text-sm font-medium text-navy-800 truncate">{p.department_code || p.department_name}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-0.5">Vehicle</p>
                    <p className="text-sm font-medium text-navy-800 truncate">{p.vehicle_number || '—'}</p>
                  </div>
                </div>

                {/* Material */}
                {p.material_summary && (
                  <div className="border-t border-surface-200/60 pt-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-navy-400 mb-1">Material</p>
                    <p className="text-sm text-navy-600 leading-relaxed line-clamp-2">{p.material_summary}</p>
                  </div>
                )}

                {/* Meta badges row */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-matched-700 bg-matched-50/80 px-2.5 py-1 rounded-full">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    {p.item_count} item{p.item_count !== 1 ? 's' : ''}
                  </span>

                  {p.type === 'RGP' && p.return_status !== 'not_applicable' && (
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium
                      ${p.is_overdue
                        ? 'bg-overdue-100/80 text-overdue-700 border border-overdue-300/50'
                        : 'bg-brand-50/80 text-brand-700 border border-brand-200/50'}`}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      {p.is_overdue ? 'Overdue' : p.return_status === 'awaiting_return' ? 'Awaiting Return' : p.return_status === 'returned' ? 'Returned' : ''}
                    </span>
                  )}
                </div>

                {/* Footer: raised at + by */}
                <div className="flex items-center gap-2 text-[11px] text-navy-400 pt-2 border-t border-surface-200/40">
                  <span>Raised {formatTime(p.created_at)}</span>
                  <span className="w-1 h-1 rounded-full bg-navy-300/50" />
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
