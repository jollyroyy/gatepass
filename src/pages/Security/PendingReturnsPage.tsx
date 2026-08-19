// Pending RGP Return (Needs Verification) — the return queue as a page of its
// own (client mock-up, 2026-08-19), opened by the figure on the dashboard.
//
// WHAT IS ON IT, AND WHAT IS DELIBERATELY NOT. `needsReturnVerification` is an
// open return (`awaiting_return` or `partially_returned`) graded `due_today` or
// `overdue` by the database in `site_tz()`. Material due in October is a real
// obligation that no guard is watching the barrier for, and neither `/returns`
// nor `/overdue` would accept its return today, so a row for it would be a
// button that cannot be pressed. The whole backlog of any date is one click
// away on Overdue Items.
//
// THIS IS WHERE A RETURN IS ACTUALLY RECORDED, line by line and quantity by
// quantity: 800 of the 1,000 litres that went out is a complete answer, and the
// row's own panel takes it. The commit is a deliberate second press inside that
// panel — `apply_item_returns` has no undo — and once it resolves, `reload`
// re-reads both queues so the list agrees with the database rather than with a
// client-side patch of it.
//
// NO TAB STRIP AND NO SEARCH BAR ON THIS PAGE (client, 2026-08-19). The status
// tabs (All · Due Today · Overdue · Returned Partially) said in four counts what
// the Status column and the filter bar already say per row, and the global
// search belongs where a guard goes looking for a pass they cannot see — Pending
// OUT and the dashboard's Scan QR both still carry it. This page is a queue: the
// filter bar narrows it and the rows are worked through. `filters.tab` stays at
// its default 'all', so `applyReturnFilters` is unchanged and the tab machinery
// is still there for the day the client wants it back.
//
// There is no type filter either: only an RGP comes back, so a control with one
// live option is a control that teaches nothing.
import React, { useMemo, useState } from 'react';
import GuardPageHeader from '../../components/guard/GuardPageHeader';
import GuardPager from '../../components/guard/GuardPager';
import PendingReturnFilterBar from '../../components/guard/PendingReturnFilterBar';
import PendingReturnTable from '../../components/guard/PendingReturnTable';
import ReturnLegend from '../../components/guard/ReturnLegend';
import { pendingReturnsOf } from '../../lib/guardBoard';
import { DEFAULT_ROWS_PER_PAGE, scopeOptions } from '../../lib/pendingOutFilters';
import {
  applyReturnFilters,
  DEFAULT_RETURN_FILTERS,
  type PendingReturnFilters,
} from '../../lib/pendingReturnFilters';
import { pageOf } from '../../lib/scheduledReturns';
import { useGuardQueues } from '../../lib/useGuardQueues';

export default function PendingReturnsPage(): React.ReactElement {
  const { openReturns, loading, error, reload } = useGuardQueues('returns');
  const [filters, setFilters] = useState<PendingReturnFilters>(DEFAULT_RETURN_FILTERS);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_ROWS_PER_PAGE);
  // Stamped once, at mount: a clock that ticks re-renders the whole table every
  // second for a fact that changes by the minute.
  const [stamp] = useState(() => new Date().toISOString());

  const rows = useMemo(() => pendingReturnsOf(openReturns), [openReturns]);
  const { parties, departments } = useMemo(() => scopeOptions(rows), [rows]);
  const filtered = useMemo(() => applyReturnFilters(rows, filters), [rows, filters]);
  const current = pageOf(filtered, page, size);

  // Narrowing must not leave the reader on page 9 of 2 — `pageOf` clamps, and
  // this puts the control back in step with what it clamped to.
  function narrow(next: PendingReturnFilters): void {
    setFilters(next);
    setPage(1);
  }

  return (
    <div className="gb-board">
      <GuardPageHeader
        title="Pending RGP Return (Needs Verification)"
        subtitle="Verify returned materials for RGP passes."
        glyph="returned"
        tone="blue"
        stamp={stamp}
      />

      <PendingReturnFilterBar
        filters={filters}
        parties={parties}
        departments={departments}
        onChange={narrow}
        onReset={() => narrow(DEFAULT_RETURN_FILTERS)}
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
              ? 'Nothing is due back today, and nothing is late.'
              : 'No pass matches these filters.'}
          </div>
        ) : (
          <>
            <div className="gb-scroll">
              <PendingReturnTable rows={current.rows} onRecorded={reload} />
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
            <ReturnLegend />
          </>
        )}
      </section>
    </div>
  );
}
