// Pending RGP Return (Needs Verification) — the return queue, drawn UNDER the
// figure that counted it on the guard's dashboard (client, 2026-08-22).
//
// THIS USED TO BE A PAGE AND A SIDEBAR TAB (`/pending-returns`), and the client
// took both away — see `PendingOutPanel`'s header for the instruction. The list
// is now what a pressed figure opens, on the same page, and nothing else.
//
// WHAT IS ON IT, AND WHAT IS DELIBERATELY NOT. `pendingReturnsOf` is an open
// return (`awaiting_return` or `partially_returned`) graded `due_today` by the
// database in `site_tz()`. ONCE THE DATE HAS PASSED THE PASS LEAVES THIS QUEUE
// FOR OVERDUE RETURNS and appears in exactly one place (client, 2026-08-23:
// "it should not show it in the pending return, it should show only in the
// overdue section"). Material due in October is absent too: no guard is
// watching the barrier for it, and `/returns` would not accept its return
// today. Both the backlog and the future are one Quick Action away on Overdue
// Items.
//
// THIS IS STILL WHERE A RETURN IS ACTUALLY RECORDED, line by line and quantity
// by quantity: 800 of the 1,000 litres that went out is a complete answer, and
// the row's own panel takes it. The commit is a deliberate second press inside
// that panel — `apply_item_returns` has no undo — and once it resolves,
// `onRecorded` re-reads both queues so the list, and the figure above it,
// agree with the database rather than with a client-side patch of it.
//
// NO TAB STRIP (client, 2026-08-19): the status tabs said in four counts what
// the Status column and the filter bar already say per row. `filters.tab` stays
// at its default 'all', so `applyReturnFilters` is unchanged and the machinery
// is still there for the day the client wants it back. There is no type filter
// either — only an RGP comes back, so a control with one live option teaches
// nothing.
import React, { useMemo, useState } from 'react';
import GuardPager from './GuardPager';
import PendingReturnFilterBar from './PendingReturnFilterBar';
import PendingReturnTable from './PendingReturnTable';
import ReturnLegend from './ReturnLegend';
import type { GatePassView } from '../../types';
import { DEFAULT_ROWS_PER_PAGE, scopeOptions } from '../../lib/pendingOutFilters';
import {
  applyReturnFilters,
  DEFAULT_RETURN_FILTERS,
  type PendingReturnFilters,
} from '../../lib/pendingReturnFilters';
import { pageOf } from '../../lib/scheduledReturns';

type Props = {
  /** The passes the pressed figure counted. */
  rows: GatePassView[];
  loading: boolean;
  /** Re-read the queues after a return is recorded. */
  onRecorded: () => void;
};

export default function PendingReturnsPanel({ rows, loading, onRecorded }: Props): React.ReactElement {
  const [filters, setFilters] = useState<PendingReturnFilters>(DEFAULT_RETURN_FILTERS);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_ROWS_PER_PAGE);

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
    <section className="gb-drill" role="region" aria-label="Pending RGP Return (Needs Verification)">
      <PendingReturnFilterBar
        filters={filters}
        parties={parties}
        departments={departments}
        onChange={narrow}
        onReset={() => narrow(DEFAULT_RETURN_FILTERS)}
      />

      <section className="gb-card gb-panel">
        {loading ? (
          <div className="gb-empty">
            <div className="gb-skeleton" />
          </div>
        ) : current.total === 0 ? (
          <div className="gb-empty">
            {rows.length === 0
              ? 'Nothing is due back today.'
              : 'No pass matches these filters.'}
          </div>
        ) : (
          <>
            <div className="gb-scroll">
              <PendingReturnTable rows={current.rows} onRecorded={onRecorded} />
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
    </section>
  );
}
