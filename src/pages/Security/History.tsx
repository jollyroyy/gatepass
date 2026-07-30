// Security's verification history — matched and flagged passes, searchable
// and exportable. Reads `?status=` and `?today=` from the URL so KPI cards on
// the GateConsole can deep-link straight into a filtered list.
import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import type { GatePassView, PassStatus } from '../../types';
import Badge, { TypeChip } from '../../components/Badge';
import { STATUS_STYLES } from '../../lib/statusStyles';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';
import { downloadCsv, type CsvColumn } from '../../lib/exportUtils';

const HISTORY_LIMIT = 200;

type HistoryStatus = Extract<PassStatus, 'matched' | 'flagged'>;

const STATUS_TABS: { key: HistoryStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched' },
  { key: 'flagged', label: 'Mismatched' },
];

const CSV_COLUMNS: CsvColumn[] = [
  { key: 'pass_number', header: 'Pass No' },
  { key: 'type', header: 'Type' },
  { key: 'visitor_name', header: 'Visitor' },
  { key: 'material_summary', header: 'Material' },
  { key: 'total_quantity', header: 'Total Qty' },
  { key: 'item_count', header: 'Items' },
  { key: 'status', header: 'Status' },
  { key: 'verified_by_name', header: 'Verified By' },
  { key: 'verified_at', header: 'Verified At' },
  { key: 'flag_reason', header: 'Mismatch Reason' },
];

function startOfTodayIso(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function History(): React.ReactElement {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<HistoryStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  // Read initial filter from URL params (set by GateConsole KPI card clicks).
  const urlStatus = searchParams.get('status') as HistoryStatus | null;
  const urlTodayOnly = searchParams.get('today') === '1';

  // Sync URL param into local state once on mount.
  useEffect(() => {
    if (urlStatus === 'matched' || urlStatus === 'flagged') {
      setStatusFilter(urlStatus);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        let query = gp()
          .from('v_gate_passes')
          .select('*')
          .in('status', ['matched', 'flagged'])
          .order('verified_at', { ascending: false })
          .limit(HISTORY_LIMIT);

        // Today's matched/mismatched counts live on GateConsole's KPI cards;
        // this page is the PAST log. Without this split, a pass verified
        // minutes ago would show as "today" on the console AND in history,
        // and clicking the console's "today" count landed on unfiltered
        // all-time history instead of just today (the reported bug).
        query = urlTodayOnly
          ? query.gte('verified_at', startOfTodayIso())
          : query.lt('verified_at', startOfTodayIso());

        const { data, error: loadErr } = await query;
        if (loadErr) throw loadErr;
        if (!cancelled) setRows((data as GatePassView[] | null) ?? []);
      } catch (err) {
        if (!cancelled) setError(safeErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = rows.filter((p) => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const hit =
        p.pass_number.toLowerCase().includes(q) ||
        p.visitor_name.toLowerCase().includes(q) ||
        (p.vehicle_number ?? '').toLowerCase().includes(q) ||
        (p.material_summary ?? '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  // Every row on the Matched tab has no flag_reason — the column would just
  // read "—" down the whole table, so it's dropped there rather than shown
  // as dead weight. All/Mismatched can both contain flagged rows, so it stays.
  const showMismatchReason = statusFilter !== 'matched';

  function handleExport() {
    downloadCsv('security-history.csv', filtered as unknown as Record<string, unknown>[], CSV_COLUMNS);
  }

  return (
    <div>
      <div className="page-header flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Verification History</h1>
          <p className="page-subtitle">
            {urlTodayOnly
              ? "Today's matched and mismatched passes, most recent first."
              : 'Past matched and mismatched passes — today’s are on the Gate Console.'}
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={handleExport}>
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center mb-6">
        <div className="tab-group">
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
        <input
          className="input w-auto min-w-[260px]"
          placeholder="Search pass no / visitor / vehicle / material…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && <div className="alert-error mb-6">{error}</div>}

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="table-wrap empty-state">
          {rows.length === 0 ? 'No verified passes yet.' : 'No passes match this search.'}
        </div>
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
                <th>Verified By</th>
                <th>Verified At</th>
                {showMismatchReason && <th>Mismatch Reason</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/pass/${p.id}`)}>
                  <td className="font-semibold text-navy-900">{p.pass_number}</td>
                  <td>
                    <TypeChip type={p.type} />
                  </td>
                  <td>{p.visitor_name}</td>
                  <td className="max-w-[200px] truncate">{p.material_summary ?? ''}</td>
                  <td className="tabular">
                    {p.item_count} item(s)
                  </td>
                  <td>
                    <Badge style={STATUS_STYLES[p.status]} />
                  </td>
                  <td>{p.verified_by_name ?? '—'}</td>
                  <td className="tabular whitespace-nowrap">{formatDateTime(p.verified_at)}</td>
                  {showMismatchReason && (
                    <td className="max-w-[180px] truncate" title={p.flag_reason ?? undefined}>
                      {p.flag_reason ?? '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
