// Pending Approvals — one office's queue on migration 046's ladder, drawn as
// the guard's own screen (client, 2026-08-19: "all the pending approvals should
// show up there in a stacked format, the styling should be the guard's view
// style, put the KPI number and make it reliable").
//
// ONE FIGURE AND THE STACK IT OPENS — the very shape `/overdue` took when the
// client asked for the guard's screen everywhere. The count is `rows.length` of
// the array the stack renders, never a second query and never an aggregate, so
// the number over the cards cannot say 5 above a stack of 4. Narrowing with the
// search or a filter narrows BOTH, because they are one array read twice.
//
// EACH CARD CARRIES APPROVE / REJECT ON ITS RIGHT (client, 2026-08-20: "on the
// right-hand side he can click on approve or reject, and rejection also should
// come with a mandatory justification" · "as simple, clear and minimal as
// possible"). That REVERSES the 2026-08-19 rule that a stacked card offers
// nothing to press — and only here: `PassStackCard` draws controls only when a
// list hands it some, so every other stack is untouched.
//
// The record still signs too. The whole card is still a link to `/pass/:id`,
// where `ApprovalDecisionBar` offers the same two decisions at the foot of the
// full reading. Both go through `approvalActions.ts`, never the RPCs, so
// whichever surface is used the next office still gets its letter.
//
// THE QUEUE IS RE-READ AFTER EVERY DECISION, never patched: only the database
// knows whether that press was the pass's last level.
//
// `office` comes from `App.tsx`, which resolved `my_approval_role()` once at
// sign-in and holds it beside `role`. `null` means this account holds no office
// at all: the empty state below is drawn and no query is made.
//
// SAME SKIN AS EVERY OTHER BOARD. `.gb-board` paints the mock-up's white ground
// and Inter type; `.gb-main` rides alongside it so the house components this
// page renders take their light halves instead of the shipped dark default.
import React, { useMemo, useState } from 'react';
import GuardPageHeader from '../../components/guard/GuardPageHeader';
import GuardIcon from '../../components/guard/GuardIcon';
import GuardPager from '../../components/guard/GuardPager';
import { Link } from 'react-router-dom';
import PassStack from '../../components/PassStack';
import ApprovalCardActions from '../../components/approver/ApprovalCardActions';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';
import {
  applyApprovalFilters,
  DEFAULT_APPROVAL_FILTERS,
  departmentOptions,
  inMyQueue,
  sortOldestFirst,
  type PendingApprovalFilters,
} from '../../lib/pendingApprovals';
import { pageOf } from '../../lib/scheduledReturns';
import { usePendingApprovals } from '../../lib/usePendingApprovals';

/** Ten cards is about a screen and a half. A card is tall where a table row is
 *  not, so the page size is the guard's stack size, not the table's five. */
const PAGE_SIZE = 10;

const SearchGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
  </svg>
);

const Chevron = ({ open }: { open: boolean }): React.ReactElement => (
  <svg
    className="gpo-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    style={{ transform: open ? 'rotate(180deg)' : undefined }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export default function PendingApprovals({ office }: { office: ApprovalRoleKey | null }): React.ReactElement {
  const { passes, approvals, loading, error, reload } = usePendingApprovals(office);
  const [filters, setFilters] = useState<PendingApprovalFilters>(DEFAULT_APPROVAL_FILTERS);
  const [open, setOpen] = useState(true);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(PAGE_SIZE);
  const [stamp] = useState(() => new Date().toISOString());

  const queue = useMemo(
    () => (office ? sortOldestFirst(inMyQueue(passes, approvals, office)) : []),
    [passes, approvals, office]
  );
  const departments = useMemo(() => departmentOptions(queue), [queue]);
  const rows = useMemo(() => applyApprovalFilters(queue, filters), [queue, filters]);
  const view = pageOf(rows, page, size);
  // THE FIGURE IS THE STACK'S OWN LENGTH. Not `queue.length` — a filtered list
  // under an unfiltered number is exactly the disagreement this rule exists to
  // prevent.
  const total = rows.length;

  function narrow(next: PendingApprovalFilters): void {
    setFilters(next);
    setPage(1);
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
        subtitle={`Signing as ${APPROVAL_ROLE_TITLES[office]}. Approve or reject below, or open a pass to read it in full.`}
        glyph="exchange"
        tone="purple"
        stamp={stamp}
      />

      {error && <div className="gb-alert">{error}</div>}

      {loading ? (
        <div className="gb-card gb-panel">
          <div className="gb-empty">
            <div className="gb-skeleton" />
          </div>
        </div>
      ) : (
        <>
          <button
            type="button"
            className="gpo-total"
            aria-expanded={open}
            aria-controls="approval-stack"
            disabled={total === 0}
            onClick={() => setOpen((v) => !v)}
          >
            <GuardIcon glyph="exchange" tone="purple" shape="square" />
            <span className="gpo-total-body">
              <span className="gpo-total-title">Awaiting Your Approval</span>
              <span className="gpo-total-figure">{total}</span>
              <span className="gpo-total-note">
                {total === 0
                  ? 'Nothing is waiting on your signature'
                  : 'Waiting on you — tap to see them'}
              </span>
            </span>
            {total > 0 && <Chevron open={open} />}
          </button>

          {/* THE CEO'S SECOND QUEUE (client, 2026-08-20; migration 053). One
              link, drawn for that office alone — a COO or a Security Head has
              nothing to decide there and `list_whitelist_requests` would show
              them an empty page. */}
          {office === 'ceo' && (
            <div className="gb-card gb-quick">
              <h2 className="gb-quick-title">Quick Actions</h2>
              <div className="gb-raise-grid">
                <Link to="/whitelist" className="gb-raise-tile">
                  <GuardIcon glyph="alert" tone="red" shape="square" />
                  <span className="gb-raise-title">Whitelist Requests</span>
                  <span className="gb-raise-note">Take a vendor off the blacklist</span>
                </Link>
              </div>
            </div>
          )}

          <div className="gb-filters">
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

          {total === 0 ? (
            <div className="gb-card gb-panel">
              <div className="gb-empty">
                {queue.length === 0
                  ? 'Nothing is waiting on your signature.'
                  : 'No request matches these filters.'}
              </div>
            </div>
          ) : (
            open && (
              <div id="approval-stack">
                <PassStack
                  passes={view.rows}
                  renderActions={(p) => <ApprovalCardActions pass={p} onDecided={reload} />}
                />
                <div className="gb-card gb-panel gpo-stack-foot">
                  <GuardPager
                    page={view}
                    size={size}
                    onPage={setPage}
                    onSize={(n) => {
                      setSize(n);
                      setPage(1);
                    }}
                  />
                </div>
              </div>
            )
          )}
        </>
      )}
    </div>
  );
}
