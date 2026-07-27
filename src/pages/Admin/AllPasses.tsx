// Admin org-wide pass view. Admin RLS sees every department's rows, so the KPI
// row, the per-department breakdown, and the filter dropdowns are all derived
// client-side from ONE loaded set — no per-department round trip.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, PassKpis, PassStatus, PassType } from '../../types';
import { EMPTY_KPIS } from '../../types';
import KpiCard from '../../components/KpiCard';
import Badge, { TypeChip } from '../../components/Badge';
import { STATUS_STYLES } from '../../lib/statusStyles';
import { PASS_TYPE_LIST, PASS_TYPES } from '../../lib/passTypes';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import { downloadCsv, type CsvColumn } from '../../lib/exportUtils';
import DeptBreakdownTable, { type DeptBreakdown } from './DeptBreakdownTable';

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

const STATUS_TABS: { key: PassStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'matched', label: 'Matched' },
  { key: 'flagged', label: 'Flagged' },
];

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'pass_number', header: 'Pass No' },
  { key: 'type', header: 'Type' },
  { key: 'department_name', header: 'Department' },
  { key: 'visitor_name', header: 'Visitor' },
  { key: 'material_description', header: 'Material' },
  { key: 'quantity', header: 'Quantity' },
  { key: 'unit', header: 'Unit' },
  { key: 'status', header: 'Status' },
  { key: 'raised_by_name', header: 'Raised By' },
  { key: 'created_at', header: 'Raised At' },
];

const SKELETON_ROWS = 8;

export default function AllPasses(): React.ReactElement {
  const navigate = useNavigate();
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [kpis, setKpis] = useState<PassKpis>(EMPTY_KPIS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<PassStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<PassType | 'all'>('all');
  const [deptFilter, setDeptFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [kpiRes, rowsRes] = await Promise.all([
        gp().rpc('kpis', { p_department_id: null }),
        gp().from('v_gate_passes').select('*').order('created_at', { ascending: false }),
      ]);
      if (kpiRes.error) throw kpiRes.error;
      if (rowsRes.error) throw rowsRes.error;
      const kpiRows = (kpiRes.data as KpiRow[] | null) ?? [];
      setKpis(mapKpiRow(kpiRows[0]));
      setRows((rowsRes.data as GatePassView[] | null) ?? []);
      setError(null);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const deptOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of rows) map.set(p.department_id, p.department_name);
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const breakdown = useMemo<DeptBreakdown[]>(() => {
    const map = new Map<string, DeptBreakdown>();
    for (const p of rows) {
      const entry = map.get(p.department_id) ?? {
        id: p.department_id,
        name: p.department_name,
        pending: 0,
        matched: 0,
        flagged: 0,
      };
      if (p.status === 'pending') entry.pending += 1;
      else if (p.status === 'matched') entry.matched += 1;
      else if (p.status === 'flagged') entry.flagged += 1;
      map.set(p.department_id, entry);
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const filtered = useMemo(
    () =>
      rows.filter((p) => {
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (typeFilter !== 'all' && p.type !== typeFilter) return false;
        if (deptFilter !== 'all' && p.department_id !== deptFilter) return false;
        if (search.trim()) {
          const q = search.trim().toLowerCase();
          const hit =
            p.pass_number.toLowerCase().includes(q) ||
            p.visitor_name.toLowerCase().includes(q) ||
            (p.vehicle_number ?? '').toLowerCase().includes(q);
          if (!hit) return false;
        }
        return true;
      }),
    [rows, statusFilter, typeFilter, deptFilter, search],
  );

  function handleExport() {
    downloadCsv('all-passes.csv', filtered as unknown as Record<string, unknown>[], CSV_COLUMNS);
  }

  return (
    <div>
      <div className="page-header flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">All Passes</h1>
          <p className="page-subtitle">Org-wide view across every department.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={handleExport}>
          Export CSV
        </button>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-8">
        <KpiCard
          label="Total"
          value={kpis.total}
          tone="neutral"
          loading={loading}
          delta={kpis.returnRate > 0 ? `${kpis.returnRate}% return rate` : kpis.raisedToday > 0 ? `▲ ${kpis.raisedToday} today` : undefined}
        />
        <KpiCard label="Pending" value={kpis.pending} tone="pending" loading={loading} />
        <KpiCard label="Matched" value={kpis.matched} tone="matched" loading={loading} />
        <KpiCard label="Flagged" value={kpis.flagged} tone="flagged" loading={loading} delta={kpis.flaggedRate > 0 ? `${kpis.flaggedRate}% flag rate` : undefined} />
        <KpiCard label="Awaiting Return" value={kpis.awaitingReturn} tone="brand" loading={loading} />
        <KpiCard label="Return Rate" value={`${kpis.returnRate}%`} tone="matched" loading={loading} />
        <KpiCard label="Overdue" value={kpis.overdue} tone="overdue" loading={loading} delta={kpis.overdueValue > 0 ? `₹${kpis.overdueValue.toLocaleString('en-IN')} in value` : undefined} />
      </div>

      {!loading && breakdown.length > 0 && <DeptBreakdownTable rows={breakdown} />}

      <div className="flex flex-col gap-4 mb-6">
        <div className="tab-group w-fit">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={statusFilter === tab.key ? 'tab-active' : 'tab-inactive'}
              onClick={() => setStatusFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-3 items-center">
          <select
            className="input w-auto"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as PassType | 'all')}
          >
            <option value="all">All Types</option>
            {PASS_TYPE_LIST.map((t) => (
              <option key={t} value={t}>
                {PASS_TYPES[t].code} — {PASS_TYPES[t].label}
              </option>
            ))}
          </select>

          <select className="input w-auto" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="all">All Departments</option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <input
            className="input w-auto min-w-[220px]"
            placeholder="Search pass no / visitor / vehicle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="table-wrap empty-state">No passes match these filters.</div>
      ) : (
        <div className="table-wrap">
          <table className="table-base">
            <thead>
              <tr>
                <th>Pass No</th>
                <th>Type</th>
                <th>Department</th>
                <th>Visitor</th>
                <th>Material</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Raised By</th>
                <th>Raised At</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/pass/${p.id}`)}>
                  <td className="font-semibold text-navy-900">{p.pass_number}</td>
                  <td>
                    <TypeChip type={p.type} />
                  </td>
                  <td>{p.department_name}</td>
                  <td>{p.visitor_name}</td>
                  <td className="max-w-[220px] truncate">{p.material_summary ?? ''}</td>
                  <td className="tabular">
                    {p.item_count} item(s)
                  </td>
                  <td>
                    <Badge style={STATUS_STYLES[p.status]} />
                  </td>
                  <td>{p.raised_by_name}</td>
                  <td className="tabular whitespace-nowrap">{formatDateTime(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
