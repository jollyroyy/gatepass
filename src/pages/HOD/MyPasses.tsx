// HOD's own pass list: status tabs, type/department filters, text search, and
// CSV export. Status and "awaiting return" filters live in the URL so the
// Dashboard KPI cards can deep-link straight into a filtered view.
import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, PassStatus, PassType } from '../../types';
import { PASS_TYPE_LIST, PASS_TYPES } from '../../lib/passTypes';
import { safeErrorMessage } from '../../lib/errors';
import { downloadCsv, type CsvColumn } from '../../lib/exportUtils';
import MyPassesTable from './MyPassesTable';

const STATUS_TABS: { key: PassStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending for Gate Approval' },
  { key: 'matched', label: 'Matched' },
  { key: 'flagged', label: 'Mismatched' },
];

const VALID_STATUSES: PassStatus[] = ['pending', 'matched', 'flagged'];

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'pass_number', header: 'Pass No' },
  { key: 'type', header: 'Type' },
  { key: 'visitor_name', header: 'Visitor' },
  { key: 'material_description', header: 'Material' },
  { key: 'quantity', header: 'Quantity' },
  { key: 'unit', header: 'Unit' },
  { key: 'status', header: 'Status' },
  { key: 'return_status', header: 'Return Status' },
  { key: 'created_at', header: 'Raised At' },
];

export default function MyPasses(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<PassType | 'all'>('all');
  const [search, setSearch] = useState('');

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

  const filtered = rows.filter((p) => {
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
    downloadCsv('my-passes.csv', filtered as unknown as Record<string, unknown>[], CSV_COLUMNS);
  }

  return (
    <div>
      <div className="page-header flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">My Passes</h1>
          <p className="page-subtitle">All gate passes raised for your departments.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={handleExport}>
          Export CSV
        </button>
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
