// HOD landing page: KPIs and flagged passes needing attention. Every KPI is a
// drill — clicking it lists the passes behind it, on this same page, mirroring
// the guard dashboard (src/pages/Security/GuardDashboard.tsx). Realtime
// updates use a *silent* refresh (no `setLoading(true)`) so the KPI numbers
// and lists update in place instead of flashing skeletons.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase, gp, pub } from '../../supabaseClient';
import type { GatePassView, PassKpis } from '../../types';
import { EMPTY_KPIS } from '../../types';
import KpiCard from '../../components/KpiCard';
import { safeErrorMessage } from '../../lib/errors';
import { formatCurrency } from '../../lib/formatCurrency';
import { type KpiRow, mapKpiRow } from '../../lib/hodKpis';
import FlaggedReviewCard from './FlaggedReviewCard';
import DrillList from '../../components/DrillList';
import { DRILL_DEFS, DRILL_ORDER, type DrillKey } from '../../lib/hodDrills';
import { periodBounds, type DashboardPeriod } from '../../lib/dashboardPeriod';
import DashboardPeriodFilter from '../../components/DashboardPeriodFilter';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';

const FLAGGED_LIMIT = 5;

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deptNames, setDeptNames] = useState<string[]>([]);
  const [kpis, setKpis] = useState<PassKpis>(EMPTY_KPIS);
  const [flagged, setFlagged] = useState<GatePassView[]>([]);
  const [allRows, setAllRows] = useState<GatePassView[]>([]);
  const [selected, setSelected] = useState<DrillKey | null>(null);
  const [period, setPeriod] = useState<DashboardPeriod>('today');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      // `kpiRes` supplies only the decorative deltas below (today's count,
      // overdue value, mismatch rate, return rate) — every KPI's own number
      // and the list its click opens both come from `allRes`, so they can
      // never disagree.
      const [kpiRes, flaggedRes, allRes] = await Promise.all([
        gp().rpc('kpis', { p_department_id: null }),
        gp()
          .from('v_gate_passes')
          .select('*')
          .eq('status', 'flagged')
          .order('verified_at', { ascending: false })
          .limit(FLAGGED_LIMIT),
        gp().from('v_gate_passes').select('*').order('created_at', { ascending: false }),
      ]);

      if (kpiRes.error) throw kpiRes.error;
      if (flaggedRes.error) throw flaggedRes.error;
      if (allRes.error) throw allRes.error;

      const rows = (kpiRes.data as KpiRow[] | null) ?? [];
      setKpis(mapKpiRow(rows[0]));
      setFlagged((flaggedRes.data as GatePassView[] | null) ?? []);
      setAllRows((allRes.data as GatePassView[] | null) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Department names for the subtitle — cosmetic, loaded once.
  useEffect(() => {
    let cancelled = false;
    async function loadDeptNames() {
      try {
        const { data: hodDepts, error: hodErr } = await gp().from('hod_departments').select('department_id');
        if (hodErr) throw hodErr;
        const ids = (hodDepts ?? []).map((r: { department_id: string }) => r.department_id);
        if (ids.length === 0) return;
        const { data: depts, error: deptErr } = await pub().from('departments').select('id, name').in('id', ids);
        if (deptErr) throw deptErr;
        if (!cancelled) setDeptNames((depts ?? []).map((d: { name: string }) => d.name));
      } catch {
        // Cosmetic only — a failure here should not block the dashboard.
      }
    }
    loadDeptNames();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: any change to gate_passes triggers a silent re-load. Defensive
  // because a partially-mocked supabase client (tests) may not implement
  // `channel()` at all.
  useEffect(() => {
    let ch: ReturnType<typeof supabase.channel> | null = null;
    try {
      ch = supabase
        .channel('hod-dashboard-gate-passes')
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

  // The selected period (default Today) scopes every KPI and drill — historical
  // data beyond a year still lives in Reports (/my-passes for an HOD, since
  // /all-passes is admin-only per roleRoutes.ts). This filter applies BEFORE
  // any drill predicate runs, so every KPI number and every drill list
  // reflects the same period boundary consistently.
  const { start, end } = periodBounds(period);
  const scopedRows = allRows.filter((p) => {
    const t = new Date(p.created_at).getTime();
    return t >= start && t < end;
  });

  // One pass through `scopedRows` per drill, filtered by that drill's own
  // predicate. The KPI card's number and the list its click opens therefore
  // come from the exact same array — they cannot disagree.
  const drillRows = {} as Record<DrillKey, GatePassView[]>;
  for (const key of DRILL_ORDER) {
    drillRows[key] = scopedRows.filter(DRILL_DEFS[key].match);
  }

  function toggleDrill(key: DrillKey) {
    setSelected((cur) => (cur === key ? null : key));
  }

  const resultsRef = useScrollIntoViewOnChange<HTMLDivElement>(selected);

  return (
    <div>
      <div className="page-header flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{deptNames.length > 0 ? deptNames.join(' · ') : 'Your departments'}</p>
        </div>
        <DashboardPeriodFilter value={period} onChange={setPeriod} />
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {/* Zero-count renders nothing — an empty red banner would be noise, and
          this must never disagree with the Expired KPI card's own number
          since both read `drillRows.expired`. */}
      {drillRows.expired.length > 0 && (
        <div className="bg-flagged-500/10 border-l-4 border-flagged-500 rounded-r-lg px-4 py-3 mb-6">
          <p className="text-sm font-semibold text-flagged-700">
            {drillRows.expired.length} {drillRows.expired.length === 1 ? 'pass' : 'passes'} expired without
            reaching the gate.
          </p>
        </div>
      )}

      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-[11px] text-navy-400">
          Older passes are in{' '}
          <Link to="/my-passes" className="text-accent-600 hover:underline font-semibold">
            My Passes
          </Link>
          .
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
        <KpiCard
          label={DRILL_DEFS.total.label}
          value={drillRows.total.length}
          tone={DRILL_DEFS.total.tone}
          loading={loading}
          active={selected === 'total'}
          onClick={() => toggleDrill('total')}
          delta={kpis.raisedToday > 0 ? `▲ ${kpis.raisedToday} today` : undefined}
        />
        <KpiCard
          label={DRILL_DEFS.rgpIssued.label}
          value={drillRows.rgpIssued.length}
          tone={DRILL_DEFS.rgpIssued.tone}
          loading={loading}
          active={selected === 'rgpIssued'}
          onClick={() => toggleDrill('rgpIssued')}
        />
        <KpiCard
          label={DRILL_DEFS.nrgpIssued.label}
          value={drillRows.nrgpIssued.length}
          tone={DRILL_DEFS.nrgpIssued.tone}
          loading={loading}
          active={selected === 'nrgpIssued'}
          onClick={() => toggleDrill('nrgpIssued')}
        />
        <KpiCard
          label={DRILL_DEFS.pending.label}
          value={drillRows.pending.length}
          tone={DRILL_DEFS.pending.tone}
          loading={loading}
          active={selected === 'pending'}
          onClick={() => toggleDrill('pending')}
        />
        <KpiCard
          label={DRILL_DEFS.expired.label}
          value={drillRows.expired.length}
          tone={DRILL_DEFS.expired.tone}
          loading={loading}
          active={selected === 'expired'}
          onClick={() => toggleDrill('expired')}
        />
        <KpiCard
          label={DRILL_DEFS.matched.label}
          value={drillRows.matched.length}
          tone={DRILL_DEFS.matched.tone}
          loading={loading}
          active={selected === 'matched'}
          onClick={() => toggleDrill('matched')}
        />
        <KpiCard
          label={DRILL_DEFS.flagged.label}
          value={drillRows.flagged.length}
          tone={DRILL_DEFS.flagged.tone}
          loading={loading}
          active={selected === 'flagged'}
          onClick={() => toggleDrill('flagged')}
          delta={kpis.flaggedRate > 0 ? `${kpis.flaggedRate}% mismatch rate` : undefined}
        />
        <KpiCard
          label="Return Rate"
          value={`${kpis.returnRate}%`}
          tone="matched"
          loading={loading}
        />
        <KpiCard
          label={DRILL_DEFS.awaiting.label}
          value={drillRows.awaiting.length}
          tone={DRILL_DEFS.awaiting.tone}
          loading={loading}
          active={selected === 'awaiting'}
          onClick={() => toggleDrill('awaiting')}
        />
        <KpiCard
          label={DRILL_DEFS.overdue.label}
          value={drillRows.overdue.length}
          tone={DRILL_DEFS.overdue.tone}
          loading={loading}
          active={selected === 'overdue'}
          onClick={() => toggleDrill('overdue')}
          delta={kpis.overdueValue > 0 ? formatCurrency(kpis.overdueValue) : undefined}
        />
      </div>

      {/* Fed by `flagged` (unscoped `v_gate_passes` fetch), never `scopedRows` —
          a mismatch raised yesterday still needs the HOD's decision today, and
          the Today toggle must not hide an open action item. */}
      {!loading && <FlaggedReviewCard rows={flagged} onOpen={(id) => navigate(`/pass/${id}`)} />}

      {selected && (
        <div ref={resultsRef}>
          <DrillList
            def={DRILL_DEFS[selected]}
            rows={drillRows[selected]}
            loading={loading}
            onOpen={(id) => navigate(`/pass/${id}`)}
          />
        </div>
      )}
    </div>
  );
}
