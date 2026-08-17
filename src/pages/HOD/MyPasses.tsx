// HOD's own pass list: period (top-right, same premium control as the
// dashboards), status tabs, type/department filters, text search, and CSV
// export. Status and "awaiting return" filters live in the URL so the
// Dashboard KPI cards can deep-link straight into a filtered view. The PERIOD
// filter is deliberately local state, not a URL param — it is a viewing
// preference, not a destination.
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, PassStatus, PassType } from '../../types';
import { PASS_TYPE_LIST, PASS_TYPES } from '../../lib/passTypes';
import { safeErrorMessage } from '../../lib/errors';
import { downloadCsv, type CsvColumn } from '../../lib/exportUtils';
import { csvCategory, csvDateTime, csvReturnStatus, csvStatus, csvText } from '../../lib/csvCells';
import {
  MY_PASSES_PERIODS,
  myPassesPeriodBounds,
  type MyPassesPeriod,
} from '../../lib/myPassesPeriod';
import DashboardPeriodFilter from '../../components/DashboardPeriodFilter';
import MyPassesTable from './MyPassesTable';

const STATUS_TABS: { key: PassStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending for Gate Approval' },
  { key: 'matched', label: 'Matched' },
  { key: 'flagged', label: 'Mismatched' },
];

const VALID_STATUSES: PassStatus[] = ['pending', 'matched', 'flagged'];

// `material_description` / `quantity` / `unit` used to be here. Migration 013
// moved the material lines out of `gate_passes` into `gate_pass_items`, and
// nobody updated this list — so the HOD's export carried three headers with a
// blank cell under every one of them. They are replaced by the summary columns
// the view actually has, which is what this page's own table renders.
export const MY_PASSES_CSV_COLUMNS: CsvColumn<GatePassView>[] = [
  { key: 'pass_number', header: 'Pass No' },
  { key: 'type', header: 'Type', format: csvCategory },
  { key: 'visitor_name', header: "Authorized Person's Name" },
  { key: 'material_summary', header: 'Material', format: (p) => csvText(p.material_summary) },
  { key: 'item_count', header: 'Items' },
  { key: 'total_quantity', header: 'Total Qty' },
  { key: 'status', header: 'Status', format: csvStatus },
  { key: 'return_status', header: 'Return Status', format: csvReturnStatus },
  { key: 'created_at', header: 'Raised At', format: (p) => csvDateTime(p.created_at) },
];

export default function MyPasses(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<PassType | 'all'>('all');
  const [search, setSearch] = useState('');
  // Default Last 30 Days: My Passes is the HISTORY page — the dashboard links
  // here for "older passes", so a Today default would show a nearly empty
  // stack. Today and the other windows are one click away.
  const [period, setPeriod] = useState<MyPassesPeriod>('last30');

  const statusParam = searchParams.get('status');
  const statusFilter: PassStatus | 'all' = VALID_STATUSES.includes(statusParam as PassStatus)
    ? (statusParam as PassStatus)
    : 'all';
  const onlyAwaitingReturn = searchParams.get('ret') === 'awaiting_return';

  function setStatusFilter(key: PassStatus | 'all') {
    const next = new URLSearchParams(searchParams);
    if (key === 'all') next.delete('status');
    else next.set('status', key);
    setSearchParams(next, { replace: true });
  }

  function toggleAwaitingReturn() {
    const next = new URLSearchParams(searchParams);
    if (onlyAwaitingReturn) next.delete('ret');
    else next.set('ret', 'awaiting_return');
    setSearchParams(next, { replace: true });
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error: loadErr } = await gp()
        .from('v_gate_passes')
        .select('*')
        .order('created_at', { ascending: false });
      if (loadErr) throw loadErr;
      setRows((data as GatePassView[] | null) ?? []);
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

  const { start, end } = myPassesPeriodBounds(period);

  const filtered = rows.filter((p) => {
    const t = new Date(p.created_at).getTime();
    if (t < start || t >= end) return false;
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (typeFilter !== 'all' && p.type !== typeFilter) return false;
    if (onlyAwaitingReturn && p.return_status !== 'awaiting_return') return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hit =
        p.pass_number.toLowerCase().includes(q) ||
        p.visitor_name.toLowerCase().includes(q) ||
        (p.vehicle_number ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  function handleExport() {
    downloadCsv('my-passes.csv', filtered, MY_PASSES_CSV_COLUMNS);
  }

  return (
    <div>
      <div className="page-header flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">My Passes</h1>
          <p className="page-subtitle">All gate passes raised for your departments.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <DashboardPeriodFilter value={period} onChange={setPeriod} periods={MY_PASSES_PERIODS} />
          <button type="button" className="btn-secondary" onClick={handleExport}>
            Export CSV
          </button>
        </div>
      </div>

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

          <button
            type="button"
            onClick={toggleAwaitingReturn}
            className={onlyAwaitingReturn ? 'tab-active' : 'tab-inactive'}
          >
            Awaiting Return
          </button>

          <input
            className="input w-auto min-w-[220px]"
            placeholder="Search pass no / visitor / vehicle…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      <MyPassesTable rows={rows} filtered={filtered} loading={loading} />
    </div>
  );
}
