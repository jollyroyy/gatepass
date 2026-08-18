// HOD's own pass list. The three SCOPE controls all sit together in the page
// header, top right — period presets, a single-day calendar, and the RGP/NRGP
// toggle — with status tabs, "awaiting return" and text search below. Status
// and "awaiting return" live in the URL so the Dashboard KPI cards can
// deep-link straight into a filtered view. The period, date and type filters
// are deliberately local state, not URL params — they are viewing preferences,
// not destinations.
//
// The calendar and the period presets are ONE choice, not two: a picked date
// wins and narrows the stack to that single local day, and clicking any period
// clears it. Two independent windows silently intersecting would let an HOD
// pick a date inside "Today" and see nothing, with no control showing why. The
// CSV export needs no wiring for either — it writes `filtered`, the rows the
// stack is showing.
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
import { localDateString, localDayBounds } from '../../lib/reportsDateRange';
import PeriodFilter from '../../components/PeriodFilter';
import MyPassesTable from './MyPassesTable';

const STATUS_TABS: { key: PassStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending for Gate Approval' },
  // The `matched` status axis, named for what actually happened: security
  // cleared it out. No surface calls a pass "Matched" any more (client,
  // 2026-08-18) — the word described the check, not the pass, and it read as
  // finished on an RGP still standing outside the mall.
  { key: 'matched', label: 'Cleared at Gate' },
  { key: 'flagged', label: 'Mismatched' },
];

const VALID_STATUSES: PassStatus[] = ['pending', 'matched', 'flagged'];

type TypeFilter = PassType | 'all';

// Local (IST) date, not UTC — toISOString() would name yesterday before 05:30
// IST and put today out of the calendar's reach.
const TODAY = localDateString(new Date());

const TYPE_SEGMENTS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...PASS_TYPE_LIST.map((t) => ({ key: t as TypeFilter, label: PASS_TYPES[t].code })),
];

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
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  // Empty means "no single day picked" — the period presets are in charge.
  const [date, setDate] = useState('');
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

  // A picked date replaces the window with that one local day. `localDayBounds`
  // is the same local-midnight arithmetic the Reports register uses, so a day
  // means the same thing on both pages.
  const { start, end } = date ? localDayBounds(date, date) : myPassesPeriodBounds(period);

  function pickPeriod(next: MyPassesPeriod) {
    setDate('');
    setPeriod(next);
  }

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
        <div className="flex flex-wrap items-center justify-end gap-2">
          <PeriodFilter value={period} onChange={pickPeriod} periods={MY_PASSES_PERIODS} label="My Passes period" />
          <input
            type="date"
            aria-label="Date"
            value={date}
            max={TODAY}
            onChange={(e) => setDate(e.target.value)}
            className="input w-auto text-sm"
          />
          <div className="tab-group" role="group" aria-label="Pass type">
            {TYPE_SEGMENTS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                aria-pressed={key === typeFilter}
                onClick={() => setTypeFilter(key)}
                className={key === typeFilter ? 'tab-active text-xs px-4 py-1.5' : 'tab-inactive text-xs px-4 py-1.5'}
              >
                {label}
              </button>
            ))}
          </div>
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
