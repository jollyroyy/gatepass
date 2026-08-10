// The gate's working screen: the pending queue as premium cards, oldest first,
// with the pass lookup anchored to the right of the header. Every gate FIGURE
// moved to the guard dashboard (/guard-dashboard), which owns both the count and
// the list behind it — this page is the queue and nothing else.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase, gp } from '../../supabaseClient';
import type { GatePassView } from '../../types';
import { PASS_CATEGORY_LIST, PASS_CATEGORIES, categoryKey, type PassCategoryKey } from '../../lib/passTypes';
import { safeErrorMessage } from '../../lib/errors';
import GateLookup from './GateLookup';
import QueueCard from './QueueCard';

interface DeptOption {
  id: string;
  name: string;
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
  const [queue, setQueue] = useState<GatePassView[]>([]);

  const [categoryFilter, setCategoryFilter] = useState<PassCategoryKey | 'all'>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // Queue only. Every gate figure moved to the guard dashboard, which owns
      // both the count and the list behind it — see lib/guardDrills.ts.
      //
      // 'hod_reviewed' rides along with 'pending': an HOD-approved pass is
      // waiting on exactly one action — the gate — and hiding it would strand
      // a truck that has already been cleared by its department head. The HOD
      // approval ALSO refreshes expiry (migration 035), so an overridden pass
      // is a FRESH pass: it loses its original expires_at the moment the HOD
      // clears the override, and only expires again at the end of today.
      //
      // The `gte` on expires_at is the "don't show passes whose date has
      // passed" half of the 2026-08-08 rule. `is_expired` covers pending only;
      // filtering the row's own expiry instead covers BOTH states uniformly
      // and never needs recomputing in TypeScript.
      const nowIso = new Date().toISOString();
      const queueRes = await gp()
        .from('v_gate_passes')
        .select('*')
        .in('status', ['pending', 'hod_reviewed'])
        .gte('expires_at', nowIso)
        .order('created_at', { ascending: true });
      if (queueRes.error) throw queueRes.error;

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

  return (
    <div>
      {/* Title left, lookup right — the lookup is a tool, not the page, so it
          gets a fixed column rather than the full width it used to span. */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6">
        <div className="page-header !mb-0">
          <h1 className="page-title">Gate Console</h1>
          <p className="page-subtitle">Work the pending queue, or look up a pass.</p>
        </div>
        <GateLookup />
      </div>

      {flash && <div className="alert-success mb-6">{flash}</div>}

      {error && <div className="alert-error mb-6">{error}</div>}

      <div ref={queueRef} id="queue" className="mb-5">
        <div className="inline-flex items-center gap-2 bg-surface-100/60 border border-surface-200 rounded-xl px-3 py-2 backdrop-blur-sm">
          <svg className="w-4 h-4 text-navy-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

          <span className="text-xs font-medium text-navy-500 tabular whitespace-nowrap">
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
        <div className="flex flex-col gap-3">
          {filteredQueue.map((p, idx) => (
            <QueueCard key={p.id} pass={p} isOldest={idx === 0} />
          ))}
        </div>
      )}
    </div>
  );
}
