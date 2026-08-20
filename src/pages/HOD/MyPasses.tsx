// MY PASSES — the client's list mock-up (2026-08-20), drawn in the `.gb-*`
// skin every other mock-up screen in this app wears: white ground, Inter, near-
// black ink, and not one new colour.
//
// THE SHAPE IS THE MOCK'S: a title and one line under it, a search bar and a
// Filters button top right, the three type tabs with their counts, the stack of
// pass cards, and the pager. Everything the page could narrow by before is
// still here — the period and the calendar are the two dropdowns on top
// (client, 2026-08-20), and the status choice, Awaiting Return and Export CSV
// moved INTO the Filters panel rather than being dropped (see
// MyPassesFilters.tsx).
//
// THE DEPARTMENT IS DRAWN FOR AN ADMIN ALONE. An HOD's register is one
// department by RLS, so the column said the same word down the whole page
// (client, 2026-08-20). The role comes from `my_profile()` — the same server
// answer route access is decided from — and defaults to NOT showing it while
// the profile is still resolving: a column that appears a beat after the list
// is worse than one that never does.
//
// Status and "awaiting return" stay in the URL so the Dashboard's KPI cards can
// still deep-link straight into a filtered view. The period, date, type tab and
// search are deliberately local state — they are viewing preferences, not
// destinations.
//
// The calendar and the period presets are ONE choice, not two: a picked date
// wins and narrows to that single local day, and clicking any period clears it.
// Two independent windows silently intersecting would let an HOD pick a date
// inside "Today" and see nothing, with no control showing why. The CSV export
// needs no wiring for either — it writes `filtered`, the rows the stack shows.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { gp } from '../../supabaseClient';
import { isAdmin, type GatePassView, type PassStatus } from '../../types';
import { safeErrorMessage } from '../../lib/errors';
import { downloadCsv, type CsvColumn } from '../../lib/exportUtils';
import { csvCategory, csvDateTime, csvReturnStatus, csvStatus, csvText } from '../../lib/csvCells';
import { myPassesPeriodBounds, type MyPassesPeriod } from '../../lib/myPassesPeriod';
import {
  applyMyPassTab,
  matchesMyPassSearch,
  MY_PASS_TABS,
  MY_PASS_TAB_LABELS,
  myPassTabCounts,
  type MyPassTab,
} from '../../lib/myPassesList';
import { DEFAULT_ROWS_PER_PAGE } from '../../lib/pendingOutFilters';
import { localDateString, localDayBounds } from '../../lib/reportsDateRange';
import { pageOf } from '../../lib/scheduledReturns';
import { useMyProfile } from '../../lib/useMyProfile';
import GuardPager from '../../components/guard/GuardPager';
import MyPassesFilters, {
  FiltersButton,
  PeriodSelect,
  type StatusTab,
} from '../../components/mypasses/MyPassesFilters';
import MyPassesTable from './MyPassesTable';

const STATUS_TABS: StatusTab[] = [
  { key: 'all', label: 'All statuses' },
  { key: 'pending', label: 'Pending for Gate Approval' },
  // The `matched` status axis, named for what actually happened: security
  // cleared it out. No surface calls a pass "Matched" any more (client,
  // 2026-08-18) — the word described the check, not the pass.
  { key: 'matched', label: 'Cleared at Gate' },
  { key: 'flagged', label: 'Rejected at Security Gate' },
];

const VALID_STATUSES: PassStatus[] = ['pending', 'matched', 'flagged'];

// Local (IST) date, not UTC — toISOString() would name yesterday before 05:30
// IST and put today out of the calendar's reach.
const TODAY = localDateString(new Date());

// `material_description` / `quantity` / `unit` used to be here. Migration 013
// moved the material lines out of `gate_passes` into `gate_pass_items`, and
// nobody updated this list — so the HOD's export carried three headers with a
// blank cell under every one of them.
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
  const { profile } = useMyProfile();
  const showDepartment = isAdmin(profile?.role ?? null);
  const [rows, setRows] = useState<GatePassView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<MyPassTab>('all');
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_ROWS_PER_PAGE);
  // Empty means "no single day picked" — the period presets are in charge.
  const [date, setDate] = useState('');
  // Default Last 30 Days: My Passes is the HISTORY page — the dashboard links
  // here for "older passes", so a Today default would show a nearly empty stack.
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
    setPage(1);
  }

  function toggleAwaitingReturn() {
    const next = new URLSearchParams(searchParams);
    if (onlyAwaitingReturn) next.delete('ret');
    else next.set('ret', 'awaiting_return');
    setSearchParams(next, { replace: true });
    setPage(1);
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
    setPage(1);
  }

  function pickDate(next: string) {
    setDate(next);
    setPage(1);
  }

  // Everything EXCEPT the type tab, so the tab counts are over what the reader
  // has already narrowed to and the three of them still add up.
  const scoped = useMemo(
    () =>
      rows.filter((p) => {
        const t = new Date(p.created_at).getTime();
        if (t < start || t >= end) return false;
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        if (onlyAwaitingReturn && p.return_status !== 'awaiting_return') return false;
        return matchesMyPassSearch(p, search);
      }),
    [rows, start, end, statusFilter, onlyAwaitingReturn, search]
  );

  const counts = useMemo(() => myPassTabCounts(scoped), [scoped]);
  const filtered = useMemo(() => applyMyPassTab(scoped, tab), [scoped, tab]);
  const current = pageOf(filtered, page, size);

  function handleExport() {
    downloadCsv('my-passes.csv', filtered, MY_PASSES_CSV_COLUMNS);
  }

  return (
    <div className="gb-board gb-main mp-page">
      <div className="gb-page-head">
        <div>
          <h1 className="gb-page-title">My Passes</h1>
          <p className="mp-sub">View all gate passes you have raised.</p>
        </div>
        <div className="gb-search-row">
          <PeriodSelect value={period} onChange={pickPeriod} />
          <input
            type="date"
            aria-label="Date"
            className="gb-select mp-date"
            value={date}
            max={TODAY}
            onChange={(e) => pickDate(e.target.value)}
          />
          <div className="gb-search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5" />
              <path d="M16 16l4.5 4.5" />
            </svg>
            <input
              type="search"
              aria-label="Search by GP No. or Purpose"
              placeholder="Search by GP No. or Purpose..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <FiltersButton open={filtersOpen} onToggle={() => setFiltersOpen((o) => !o)} />
        </div>
      </div>

      <MyPassesFilters
        open={filtersOpen}
        statusTabs={STATUS_TABS}
        status={statusFilter}
        onStatus={setStatusFilter}
        awaitingReturn={onlyAwaitingReturn}
        onAwaitingReturn={toggleAwaitingReturn}
        onExport={handleExport}
      />

      <div className="gb-toolbar mp-toolbar">
        <div className="gb-tabs" role="tablist" aria-label="Pass type">
          {MY_PASS_TABS.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className="gb-tab"
              onClick={() => {
                setTab(key);
                setPage(1);
              }}
            >
              {MY_PASS_TAB_LABELS[key]} ({counts[key]})
            </button>
          ))}
        </div>
      </div>

      {error && <div className="gb-alert">{error}</div>}

      <MyPassesTable
        rows={rows}
        filtered={current.rows}
        loading={loading}
        showDepartment={showDepartment}
      />

      {!loading && current.total > 0 && (
        <div className="mp-foot">
          <GuardPager
            page={current}
            size={size}
            onPage={setPage}
            onSize={(n) => {
              setSize(n);
              setPage(1);
            }}
          />
        </div>
      )}
    </div>
  );
}
