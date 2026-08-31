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
// A CARD ALSO UNFOLDS (client, 2026-08-20: "for each stacked card there is an
// option to expand the stacked card, also just to see the details about the
// item and its individual item details … before Approval or rejection"). The
// chevron beside the two buttons opens this pass's own material lines in place,
// so an office holder reads what they are signing without leaving the queue.
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
// AND THE BOARD REMEMBERS WHAT THIS PERSON DECIDED (client, 2026-08-20: "all
// four approvers should be able to see all the gate passes that they have
// approved and rejected. Make a KPI card for that in the dashboard. As well
// when they drill down on those cards, they should be able to list off all
// those things exactly as they are seeing the approval/rejection requests in
// the same stack format but without any approval/reject button"). Three
// figures now, one open at a time, and the two history stacks are the SAME
// `PassStack` — simply handed no `renderActions`, which is how every other
// stack in this app is already action-free. Nothing about a decided pass can
// be pressed, which is also the truth of it: `approve_pass_level` refuses a
// pass that is no longer `pending`, and a rejection is terminal.
//
// EVERY FIGURE IS THE LENGTH OF ITS OWN FILTERED ARRAY, so the search and the
// two selects narrow all three cards and the open stack together — the board
// invariant, not a nicety: a filtered list under an unfiltered number is the
// exact disagreement it exists to prevent.
//
// THE QUEUE IS RE-READ AFTER EVERY DECISION, never patched: only the database
// knows whether that press was the pass's last level.
//
// A FOURTH FIGURE, FOR TWO OFFICES ONLY (client, 2026-08-24; migration 067).
// The COO and the CEO carry the super admin fallback — "in the case where
// nobody is able to approve, in those scenarios the Superadmin can take charge
// and get it approved" — so "Nobody Has Approved" lists the passes held up on a
// rung BELOW them for longer than the escalation window. It offers no Approve
// or Reject: those rungs are not theirs to sign, and never become so. Opening
// such a pass shows the break-glass panel at the foot of the record, which
// takes a written reason and is reviewed by an admin afterwards. Every other
// office is not shown the card at all, rather than shown a permanent nought.
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
import ApprovalFilterBar from '../../components/approver/ApprovalFilterBar';
import ApprovalKpiCards, { type ApprovalCardKey } from '../../components/approver/ApprovalKpiCards';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';
import {
  applyApprovalFilters,
  DEFAULT_APPROVAL_FILTERS,
  departmentOptions,
  inMyQueue,
  sortOldestFirst,
  stuckBelowMe,
  type PendingApprovalFilters,
} from '../../lib/pendingApprovals';
import { decidedByMe } from '../../lib/approvalHistory';
import { pageOf } from '../../lib/scheduledReturns';
import type { GatePassView } from '../../types';
import { usePendingApprovals } from '../../lib/usePendingApprovals';
import { useEscalationHours } from '../../lib/useEscalationHours';
import { holdsFallbackOffice } from '../../lib/superAdminFallback';

/** Ten cards is about a screen and a half. A card is tall where a table row is
 *  not, so the page size is the guard's stack size, not the table's five. */
const PAGE_SIZE = 10;

export default function PendingApprovals(
  { office, offices }: { office: ApprovalRoleKey | null; offices?: ApprovalRoleKey[] },
): React.ReactElement {
  // THE DEFAULT IS THE IDENTITY. A caller that knows only which office the
  // reader IS gets exactly the behaviour it had before 072; `App.tsx`, which
  // asked the database for the whole list, passes the whole list.
  const mine = useMemo(
    () => offices ?? (office ? [office] : []),
    [offices, office],
  );
  const { passes, approvals, userId, loading, error, reload } = usePendingApprovals(mine);
  const [filters, setFilters] = useState<PendingApprovalFilters>(DEFAULT_APPROVAL_FILTERS);
  // Which figure is drilled open, or `null` for none. The queue opens first:
  // it is the one list with work in it.
  const [card, setCard] = useState<ApprovalCardKey | null>('pending');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(PAGE_SIZE);
  const [stamp] = useState(() => new Date().toISOString());
  // How long the office below a shared rung gets before it escalates (063).
  // Falls back to the shipped default, so the queue filters the same way even
  // if the settings read fails.
  const escalationHours = useEscalationHours();

  const queue = useMemo(
    () => (mine.length > 0
      ? sortOldestFirst(inMyQueue(passes, approvals, mine, escalationHours))
      : []),
    [passes, approvals, mine, escalationHours]
  );
  const approved = useMemo(
    () => decidedByMe(passes, approvals, userId, 'approved'),
    [passes, approvals, userId]
  );
  const rejected = useMemo(
    () => decidedByMe(passes, approvals, userId, 'rejected'),
    [passes, approvals, userId]
  );
  // THE SUPER ADMIN FALLBACK'S OWN LIST (067) — passes held up on a rung BELOW
  // this office for longer than the escalation window. Empty for every office
  // but the COO and the CEO, whose select policy is the only one that admits
  // such a pass at all.
  const stuck = useMemo(
    () => (holdsFallbackOffice(office)
      ? sortOldestFirst(stuckBelowMe(passes, approvals, office, escalationHours))
      : []),
    [passes, approvals, office, escalationHours]
  );

  // ONE OPTION LIST OVER ALL THREE: whichever card is open, a department
  // offered here has rows behind it somewhere on this board.
  const departments = useMemo(
    () => departmentOptions([...queue, ...approved, ...rejected, ...stuck]),
    [queue, approved, rejected, stuck]
  );

  // Each figure is its OWN filtered array, so all three narrow together and
  // none of them can stand over a list it does not describe.
  const lists: Record<ApprovalCardKey, GatePassView[]> = useMemo(() => ({
    pending: applyApprovalFilters(queue, filters),
    approved: applyApprovalFilters(approved, filters),
    rejected: applyApprovalFilters(rejected, filters),
    stuck: applyApprovalFilters(stuck, filters),
  }), [queue, approved, rejected, stuck, filters]);

  // The fourth key is OMITTED, not zeroed, for an office that does not carry
  // the fallback — a Security Head must not be shown a figure that could never
  // be anything but nought.
  const counts: Partial<Record<ApprovalCardKey, number>> = {
    pending: lists.pending.length,
    approved: lists.approved.length,
    rejected: lists.rejected.length,
    ...(holdsFallbackOffice(office) ? { stuck: lists.stuck.length } : {}),
  };
  const rows = card ? lists[card] : [];
  const view = pageOf(rows, page, size);
  const total = rows.length;

  function narrow(next: PendingApprovalFilters): void {
    setFilters(next);
    setPage(1);
  }

  /** Pressing the open card closes it; pressing another opens that one from
   *  its first page — the pager belongs to whichever stack is on screen. */
  function pickCard(next: ApprovalCardKey): void {
    setCard((cur) => (cur === next ? null : next));
    setPage(1);
  }

  if (!office) {
    return (
      <div className="gb-board gb-main">
        <GuardPageHeader
          title="Pending for My Approval"
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
        title="Pending for My Approval"
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
          <ApprovalKpiCards counts={counts} active={card} onSelect={pickCard} />

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
                  <span className="gb-raise-title">Whitelist of Vendors</span>
                  <span className="gb-raise-note">Take a vendor off the blacklist</span>
                </Link>
              </div>
            </div>
          )}

          <ApprovalFilterBar filters={filters} departments={departments} onChange={narrow} />

          {lists.pending.length + lists.approved.length + lists.rejected.length
            + lists.stuck.length === 0 ? (
            <div className="gb-card gb-panel">
              <div className="gb-empty">
                {queue.length + approved.length + rejected.length + stuck.length === 0
                  ? 'Nothing is waiting on your signature.'
                  : 'No request matches these filters.'}
              </div>
            </div>
          ) : (
            card !== null && total > 0 && (
              <div id="approval-stack">
                <PassStack
                  passes={view.rows}
                  // THE DEPARTMENT AND THE PURPOSE (client, 2026-08-20: "we
                  // also put the department name and the reason or the purpose
                  // of that RGP or an NRGP pass in the stat list across all the
                  // approvers"). One stack serves all three figures, so what is
                  // read before signing is what is read back afterwards.
                  showContext
                  // NO CONTROL ON A DECIDED PASS (client, 2026-08-20: "without
                  // any approval/reject button").
                  renderActions={
                    card === 'pending'
                      ? (p) => <ApprovalCardActions pass={p} onDecided={reload} />
                      : undefined
                  }
                  // A CARD UNFOLDS ITS OWN MATERIAL LINES (client, 2026-08-20:
                  // "just to see the details about the item and its individual
                  // item details … before Approval or rejection"). One card at
                  // a time, loaded on demand — see `PassStackItems`. A
                  // decided pass unfolds too: reading back what was signed is
                  // the whole point of these two lists.
                  expandable
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
