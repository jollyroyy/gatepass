// HOD landing page: KPIs, flagged passes needing attention, and a recent-passes
// table. Realtime updates use a *silent* refresh (no `setLoading(true)`) so the
// KPI numbers and tables update in place instead of flashing skeletons.
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, gp, pub } from '../../supabaseClient';
import type { GatePassView, PassKpis, ReturnableAgingBucket } from '../../types';
import { EMPTY_KPIS } from '../../types';
import KpiCard from '../../components/KpiCard';
import Badge, { TypeChip } from '../../components/Badge';
import { STATUS_STYLES } from '../../lib/statusStyles';
import { relativeAge } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';

const FLAGGED_LIMIT = 5;
const RECENT_LIMIT = 10;
const SKELETON_ROWS = 6;

function formatCurrency(n: number): string {
  if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
  if (n >= 1000) return '₹' + (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'K';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}

function ReturnableAging({ rows, loading }: { rows: ReturnableAgingBucket[]; loading: boolean }): React.ReactElement | null {
  if (loading || rows.length === 0) return null;
  const BUCKET_LABEL: Record<string, string> = { '0-7d': '0–7 days', '8-30d': '8–30 days', '31-90d': '31–90 days', '90+': '90+ days' };
  return (
    <div className="mb-8">
      <h2 className="section-title mb-3">Returnable Aging</h2>
      <div className="table-wrap">
        <table className="table-base">
          <thead>
            <tr>
              <th>Period</th>
              <th>Items Out</th>
              <th>Estimated Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bucket}>
                <td className="font-semibold text-navy-900">{BUCKET_LABEL[r.bucket] ?? r.bucket}</td>
                <td className="tabular">{r.item_count}</td>
                <td className="tabular">{formatCurrency(r.total_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface KpiRow {
  total: number;
  pending: number;
  matched: number;
  flagged: number;
  awaiting_return: number;
  overdue: number;
  raised_today: number;
  overdue_value: number;
  flagged_rate: number;
  return_rate: number;
}

function mapKpiRow(row: KpiRow | undefined): PassKpis {
  if (!row) return EMPTY_KPIS;
  return {
    total: row.total ?? 0,
    pending: row.pending ?? 0,
    matched: row.matched ?? 0,
    flagged: row.flagged ?? 0,
    awaitingReturn: row.awaiting_return ?? 0,
    overdue: row.overdue ?? 0,
    raisedToday: row.raised_today ?? 0,
    overdueValue: row.overdue_value ?? 0,
    flaggedRate: row.flagged_rate ?? 0,
    returnRate: row.return_rate ?? 0,
  };
}

export default function Dashboard(): React.ReactElement {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deptNames, setDeptNames] = useState<string[]>([]);
  const [kpis, setKpis] = useState<PassKpis>(EMPTY_KPIS);
  const [flagged, setFlagged] = useState<GatePassView[]>([]);
  const [recent, setRecent] = useState<GatePassView[]>([]);
  const [agingBuckets, setAgingBuckets] = useState<ReturnableAgingBucket[]>([]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [kpiRes, flaggedRes, recentRes, agingRes] = await Promise.all([
        gp().rpc('kpis', { p_department_id: null }),
        gp()
          .from('v_gate_passes')
          .select('*')
          .eq('status', 'flagged')
          .order('verified_at', { ascending: false })
          .limit(FLAGGED_LIMIT),
        gp().from('v_gate_passes').select('*').order('created_at', { ascending: false }).limit(RECENT_LIMIT),
        gp().rpc('returnable_aging', { p_department_id: null }),
      ]);

      if (kpiRes.error) throw kpiRes.error;
      if (flaggedRes.error) throw flaggedRes.error;
      if (recentRes.error) throw recentRes.error;
      if (agingRes.error) throw agingRes.error;

      const rows = (kpiRes.data as KpiRow[] | null) ?? [];
      setKpis(mapKpiRow(rows[0]));
      setFlagged((flaggedRes.data as GatePassView[] | null) ?? []);
      setRecent((recentRes.data as GatePassView[] | null) ?? []);
      setAgingBuckets((agingRes.data as ReturnableAgingBucket[] | null) ?? []);
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">{deptNames.length > 0 ? deptNames.join(' · ') : 'Your departments'}</p>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
        <KpiCard
          label="Total Raised"
          value={kpis.total}
          tone="neutral"
          loading={loading}
          delta={kpis.raisedToday > 0 ? `▲ ${kpis.raisedToday} today` : undefined}
        />
        <KpiCard
          label="Pending Verification"
          value={kpis.pending}
          tone="pending"
          to="/my-passes?status=pending"
          loading={loading}
        />
        <KpiCard label="Matched" value={kpis.matched} tone="matched" loading={loading} />
        <KpiCard
          label="Mismatched"
          value={kpis.flagged}
          tone="flagged"
          to="/my-passes?status=flagged"
          delta={kpis.flaggedRate > 0 ? `${kpis.flaggedRate}% mismatch rate` : undefined}
        />
        <KpiCard
          label="Return Rate"
          value={`${kpis.returnRate}%`}
          tone="matched"
          loading={loading}
        />
        <KpiCard
          label="Awaiting Return"
          value={kpis.awaitingReturn}
          tone="brand"
          to="/my-passes?ret=awaiting_return"
          loading={loading}
        />
        <KpiCard
          label="Overdue"
          value={kpis.overdue}
          tone="overdue"
          loading={loading}
          delta={kpis.overdueValue > 0 ? formatCurrency(kpis.overdueValue) : undefined}
        />
      </div>

      <ReturnableAging rows={agingBuckets} loading={loading} />

      {!loading && flagged.length > 0 && (
        <div className="card border border-flagged-500/30 bg-flagged-50/40 p-5 mb-8">
          <h2 className="section-title text-flagged-700 mb-3">Mismatches needing review</h2>
          <div className="flex flex-col gap-1">
            {flagged.map((p) => (
              <div
                key={p.id}
                className="list-item cursor-pointer rounded-xl hover:bg-flagged-100/40"
                onClick={() => navigate(`/pass/${p.id}`)}
              >
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-navy-900 text-sm">{p.pass_number}</span>
                    <TypeChip type={p.type} />
                    <span className="text-sm text-navy-600">{p.visitor_name}</span>
                  </div>
                   <p className="text-xs text-navy-400 truncate">{p.material_summary ?? ''}</p>
                  <p className="text-sm font-semibold text-flagged-700 mt-0.5">
                    Reason: {p.flag_reason ?? 'No reason recorded'}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <h2 className="section-title mb-3">Recent Passes</h2>
      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div className="table-wrap empty-state">No passes raised yet.</div>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Pass No</th>
                <th>Type</th>
                <th>Visitor</th>
                <th>Material</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Age</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/pass/${p.id}`)}>
                  <td className="font-semibold text-navy-900">{p.pass_number}</td>
                  <td>
                    <TypeChip type={p.type} />
                  </td>
                  <td>{p.visitor_name}</td>
                  <td className="max-w-[220px] truncate">{p.material_summary ?? ''}</td>
                  <td className="tabular">
                    {p.item_count} item(s)
                  </td>
                  <td>
                    <Badge style={STATUS_STYLES[p.status]} />
                  </td>
                  <td className="tabular">{relativeAge(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
