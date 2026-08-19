// Pending OUT (Needs Approval) — the gate queue as a page of its own (client
// mock-up, 2026-08-19).
//
// The guard's dashboard used to carry a five-row preview of this list. It now
// carries the FIGURE, and the figure is the way in: a guard reads "RGP 1 ·
// NRGP 2", clicks the number, and lands here with every waiting pass, the
// filters to narrow it and the pager to walk it.
//
// THE SEARCH IS GLOBAL AND IS NOT THIS LIST. `useGuardSearch` resolves a pass
// number through `lookup_pass` over the whole register and a mobile number
// through an unfiltered query — nothing on this page narrows it. A guard handed
// a slip for a pass that was cleared last week finds it from here.
//
// ONE QUERY, AND THE FIGURE IS THE LIST. `useGuardQueues('out')` is the same
// read the dashboard makes, `pendingOutOf` the same predicate; the tab counts,
// the filter options and the table are three readings of that one array.
import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import GuardPageHeader from '../../components/guard/GuardPageHeader';
import GuardPager from '../../components/guard/GuardPager';
import GuardToolbar from '../../components/guard/GuardToolbar';
import PendingOutFilterBar from '../../components/guard/PendingOutFilterBar';
import PendingOutTable from '../../components/guard/PendingOutTable';
import { useGuardSearch } from '../../components/guard/useGuardSearch';
import { pendingOutOf } from '../../lib/guardBoard';
import {
  applyFilters,
  DEFAULT_FILTERS,
  DEFAULT_ROWS_PER_PAGE,
  scopeOptions,
  tabCounts,
  TYPE_TAB_LABELS,
  TYPE_TABS,
  type PendingOutFilters,
  type TypeTab,
} from '../../lib/pendingOutFilters';
import { pageOf } from '../../lib/scheduledReturns';
import { useGuardQueues } from '../../lib/useGuardQueues';

export default function PendingOutPage(): React.ReactElement {
  const { queue, loading, error } = useGuardQueues('out');
  // `?type=RGP` is how the dashboard's RGP figure opens this page already
  // narrowed to what it counted — the drill lands on the rows behind the
  // number, not on a list the reader has to narrow again. Read ONCE, as the
  // initial state: afterwards the tabs own the choice, so a click does not
  // fight the URL.
  const [params] = useSearchParams();
  const [filters, setFilters] = useState<PendingOutFilters>(() => {
    const wanted = params.get('type');
    const tab = TYPE_TABS.find((t) => t === wanted) as TypeTab | undefined;
    return tab ? { ...DEFAULT_FILTERS, tab } : DEFAULT_FILTERS;
  });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_ROWS_PER_PAGE);
  // Stamped once, at mount: a clock that ticks re-renders the whole table
  // every second for a fact that changes by the minute.
  const [stamp] = useState(() => new Date().toISOString());

  const search = useGuardSearch('Search by Pass No., Party, Mobile No.…');

  const rows = useMemo(() => pendingOutOf(queue), [queue]);
  const counts = useMemo(() => tabCounts(rows), [rows]);
  const { parties, departments } = useMemo(() => scopeOptions(rows), [rows]);
  const filtered = useMemo(() => applyFilters(rows, filters), [rows, filters]);
  const current = pageOf(filtered, page, size);

  // Narrowing the list must not leave the reader on page 9 of 2 — `pageOf`
  // clamps, and this puts the control back in step with what it clamped to.
  function narrow(next: PendingOutFilters): void {
    setFilters(next);
    setPage(1);
  }

  return (
    <div className="gb-board">
      <GuardPageHeader
        title="Pending OUT (Needs Approval)"
        subtitle="Approve gate passes for materials leaving the site."
        glyph="truck"
        tone="orange"
        stamp={stamp}
      />

      <GuardToolbar
        tabs={{
          label: 'Pass type',
          items: TYPE_TABS.map((t) => ({ key: t, label: TYPE_TAB_LABELS[t], count: counts[t] })),
          active: filters.tab,
          onSelect: (tab) => narrow({ ...filters, tab: tab as TypeTab }),
        }}
        search={search.bar}
      />

      {search.notice}

      {search.results ?? (
        <>
          <PendingOutFilterBar
            filters={filters}
            parties={parties}
            departments={departments}
            onChange={narrow}
            onReset={() => narrow(DEFAULT_FILTERS)}
          />

          {error && <div className="gb-alert">{error}</div>}

          <section className="gb-card gb-panel">
            {loading ? (
              <div className="gb-empty">
                <div className="gb-skeleton" />
              </div>
            ) : current.total === 0 ? (
              <div className="gb-empty">
                {rows.length === 0
                  ? 'Queue clear — nothing is waiting at the gate.'
                  : 'No pass matches these filters.'}
              </div>
            ) : (
              <>
                <div className="gb-scroll">
                  <PendingOutTable rows={current.rows} />
                </div>
                <GuardPager
                  page={current}
                  size={size}
                  onPage={setPage}
                  onSize={(n) => {
                    setSize(n);
                    setPage(1);
                  }}
                />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
