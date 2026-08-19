// Pending Approvals — one office's queue on migration 046's ladder (client
// mock-up, 2026-08-19).
//
// `office` comes from `App.tsx`, which already resolved `my_approval_role()`
// once at sign-in and holds it beside `role`. `null` means this account holds
// no approval office at all: the empty state below is drawn and no query is
// made — `usePendingApprovals(null)` guards that itself.
//
// SAME SKIN AS THE HOD DASHBOARD. `.gb-board` paints the mock-up's white
// ground and Inter type; `.gb-main` rides alongside it so the house
// components this page still renders — `RejectApprovalModal`'s `.modal-*`
// classes and the row's status-tinted buttons — take their light halves
// instead of the shipped dark default. An approver's account is `staff` and
// gets no `.gb-main` from `AppShell` (that class is reserved for a guard's
// shell), so the page opts in itself, exactly as `HOD/Dashboard.tsx` does.
//
// THE QUEUE, THE FILTER OPTIONS AND THE ROWS ARE THREE READINGS OF ONE LOADED
// PAIR OF ARRAYS (`usePendingApprovals`) — the board's oldest invariant,
// carried onto an approver's screen: a count can never disagree with the list
// under it, because nothing here is a second query with its own predicate.
import React, { useMemo, useState } from 'react';
import GuardPageHeader from '../../components/guard/GuardPageHeader';
import GuardPager from '../../components/guard/GuardPager';
import PendingApprovalsTable from '../../components/approver/PendingApprovalsTable';
import WaitingBelowSection from '../../components/approver/WaitingBelowSection';
import { approvePass, rejectPass } from '../../lib/approvalActions';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';
import {
  applyApprovalFilters,
  DEFAULT_APPROVAL_FILTERS,
  departmentOptions,
  inMyQueue,
  sortOldestFirst,
  waitingBelowMe,
  type PendingApprovalFilters,
} from '../../lib/pendingApprovals';
import { pageOf } from '../../lib/scheduledReturns';
import { DEFAULT_ROWS_PER_PAGE } from '../../lib/pendingOutFilters';
import { usePendingApprovals } from '../../lib/usePendingApprovals';

const SearchGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
  </svg>
);

export default function PendingApprovals({ office }: { office: ApprovalRoleKey | null }): React.ReactElement {
  const { passes, approvals, loading, error, reload } = usePendingApprovals(office);
  const [filters, setFilters] = useState<PendingApprovalFilters>(DEFAULT_APPROVAL_FILTERS);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_ROWS_PER_PAGE);
  const [stamp] = useState(() => new Date().toISOString());

  const queue = useMemo(
    () => (office ? sortOldestFirst(inMyQueue(passes, approvals, office)) : []),
    [passes, approvals, office]
  );
  const waiting = useMemo(
    () => (office ? waitingBelowMe(passes, approvals, office) : []),
    [passes, approvals, office]
  );
  const departments = useMemo(() => departmentOptions(queue), [queue]);
  const filtered = useMemo(() => applyApprovalFilters(queue, filters), [queue, filters]);
  const current = pageOf(filtered, page, size);

  function narrow(next: PendingApprovalFilters): void {
    setFilters(next);
    setPage(1);
  }

  async function approve(id: string): Promise<void> {
    await approvePass(id);
    reload();
  }

  async function reject(id: string, reason: string): Promise<void> {
    await rejectPass(id, reason);
    reload();
  }

  if (!office) {
    return (
      <div className="gb-board gb-main">
        <GuardPageHeader
          title="Pending Approvals"
          subtitle="Passes waiting on your signature."
          glyph="exchange"
          tone="purple"
          stamp={stamp}
        />
        <div className="gb-empty">This account does not hold an approval office.</div>
      </div>
    );
  }

  return (
    <div className="gb-board gb-main">
      <GuardPageHeader
        title="Pending Approvals"
        subtitle={`Signing as ${APPROVAL_ROLE_TITLES[office]}.`}
        glyph="exchange"
        tone="purple"
        stamp={stamp}
      />

      {error && <div className="gb-alert">{error}</div>}

      <section className="gb-card gb-panel">
        <div className="gb-panel-head">
          <span className="gb-panel-title">Pending Approvals ({queue.length})</span>
          <div className="gb-search-row">
            <div className="gb-search">
              {SearchGlyph}
              <input
                type="text"
                aria-label="Search by Pass ID / Vendor / Purpose"
                placeholder="Search by Pass ID / Vendor / Purpose..."
                value={filters.search}
                onChange={(e) => narrow({ ...filters, search: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="gb-filters">
          <select
            className="gb-select"
            aria-label="Pass Type"
            value={filters.type}
            onChange={(e) => narrow({ ...filters, type: e.target.value as PendingApprovalFilters['type'] })}
          >
            <option value="">Type: All</option>
            <option value="RGP">RGP</option>
            <option value="NRGP">NRGP</option>
          </select>

          <select
            className="gb-select"
            aria-label="Department"
            value={filters.department}
            onChange={(e) => narrow({ ...filters, department: e.target.value })}
          >
            <option value="">Department: All</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="gb-empty">
            <div className="gb-skeleton" />
          </div>
        ) : current.total === 0 ? (
          <div className="gb-empty">
            {queue.length === 0
              ? 'Nothing is waiting on your signature.'
              : 'No request matches these filters.'}
          </div>
        ) : (
          <>
            <div className="gb-scroll">
              <PendingApprovalsTable rows={current.rows} onApprove={approve} onReject={reject} />
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

      <WaitingBelowSection rows={waiting} />
    </div>
  );
}
