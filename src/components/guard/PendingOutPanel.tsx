// Pending OUT (Needs Approval) — the gate queue, drawn UNDER the figure that
// counted it on the guard's dashboard (client, 2026-08-22).
//
// THIS USED TO BE A PAGE AND A SIDEBAR TAB (`/pending-out`). The client took
// both away: "make sure you don't keep any separate pending out or [RGP] tab —
// all those things are already there in the dashboard. Whenever somebody is
// clicking on the drill down on the KPI number, it would open up on the same
// page. There is no need to keep a separate tab … that would only show when
// the KPI cards have been drilled down from the guard's dashboard." So the
// list has no route, no tab and no existence of its own: it is what a pressed
// figure opens, and it closes when that figure is pressed again.
//
// IT IS HANDED THE ROWS, IT DOES NOT FETCH THEM. The dashboard reads
// `useGuardQueues('both')` once and derives `pendingOutOf(queue)`; the figure
// is `rows.length` of the very array passed in here. That is the board's oldest
// invariant, and folding the page into the board is what finally makes it
// structural rather than a promise two files were keeping separately.
//
// THE SEARCH IS NOT HERE ANY MORE EITHER — it moved up to the dashboard, where
// it is drawn once for the whole screen. It never narrowed this list (it is a
// global lookup over the whole register), so nothing is lost by lifting it.
import React, { useMemo, useState } from 'react';
import GuardPager from './GuardPager';
import GuardToolbar from './GuardToolbar';
import PendingOutFilterBar from './PendingOutFilterBar';
import PendingOutTable from './PendingOutTable';
import type { GatePassView } from '../../types';
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

type Props = {
  /** The passes the pressed figure counted. */
  rows: GatePassView[];
  loading: boolean;
  /** The type the figure stood for, so the drill lands on the rows behind the
   *  number rather than on a list the reader has to narrow again. */
  initialTab: TypeTab;
};

export default function PendingOutPanel({ rows, loading, initialTab }: Props): React.ReactElement {
  const [filters, setFilters] = useState<PendingOutFilters>({ ...DEFAULT_FILTERS, tab: initialTab });
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_ROWS_PER_PAGE);

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
    <section className="gb-drill" role="region" aria-label="Pending OUT (Needs Approval)">
      <GuardToolbar
        tabs={{
          label: 'Pass type',
          items: TYPE_TABS.map((t) => ({ key: t, label: TYPE_TAB_LABELS[t], count: counts[t] })),
          active: filters.tab,
          onSelect: (tab) => narrow({ ...filters, tab: tab as TypeTab }),
        }}
      />

      <PendingOutFilterBar
        filters={filters}
        parties={parties}
        departments={departments}
        onChange={narrow}
        onReset={() => narrow({ ...DEFAULT_FILTERS, tab: filters.tab })}
      />

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
    </section>
  );
}
