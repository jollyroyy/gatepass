// THE HOD DASHBOARD — the client's own mock-up, box for box (2026-08-19):
// a greeting and a date chip, four drillable figures, Quick Actions, and the
// Approval Pending strip.
//
// A FIGURE'S LIST IS A PAGE, NOT A PANEL (client, 2026-08-23: "don't show the
// table on the same page … show it on a new page for all the KPI cards"). Every
// card is a link: `/dashboard/<key>` (see `DashboardDrill.tsx`) for the three
// that list passes, `/overdue` for the item-level board.
//
// IT IS NO LONGER `GateBoard`. That component is the ADMIN's board and stays
// exactly as it is; an HOD used to get it narrowed to one person — two KPI rows,
// a movement trend, a status ring, a return watch, a top-items ring and the
// flagged-review queue — and the client replaced the whole page with the layout
// above. What went with it, deliberately:
//
//   * THE FIVE PANELS. Every figure they carried is either on one of the four
//     cards, or one click away: `/overdue` (the HOD's own scope) is the backlog
//     the Pending Return card counts, and `/reports` is the register — My
//     Passes itself was removed on 2026-08-23 (client: "remove my passes").
//   * THE ALERTS CARD is not drawn at all (client: "remove the alert part"). Its
//     three lines restated the three cards beside it, each with a "View" link
//     to the list the card's own press now opens on `/dashboard/<key>`.
//   * THE "WAITING WITH" STRIP, which named the desk every still-waiting pass
//     was sitting with, is off this board (client, 2026-08-21: "remove Waiting
//     With ... from hod dashboard bottom"). The ADMIN's board still carries it.
//     The Approval Pending strip stays — only the other one was named — and
//     since 2026-08-21 it counts the same way, one pass against one desk, so
//     that it agrees with the two pending desk lines on the cards above it. What it does NOT
//     have is a gate row: it names approvers, and the passes waiting at the
//     barrier are the card's other sub-line.
//   * THE FLAGGED-REVIEW QUEUE ("Mismatches needing review") is off the page
//     with its panel. KNOWN COST, flagged to the client: the bell's mismatch
//     notice is now the only route to `/mismatch/:id`. Nothing became
//     unreachable — the notice is written by `flag_pass` for the raising HOD and
//     opens the review screen — but a mismatch is no longer listed on a screen
//     the HOD opens by habit.
//
// THE SKIN IS THE MOCK-UP'S, NOT THE HOUSE THEME. Same island the guard's board
// is: `.gb-board` paints its own white ground, Inter, near-black ink, and the
// mock's blue / green / purple / orange. `gb-main` rides alongside it for the
// HOUSE components the drill page renders (`DrillList` and the pass cards under
// it), which take their light halves instead of the shipped dark default;
// without it a dark pass card would sit on a white ground. Neither class has
// any effect outside this subtree, and every other HOD screen is untouched.
//
// TWO SCOPES STACK ON THE DATA, AND ONLY ONE OF THEM IS THIS PAGE'S DOING:
//   Department — RLS. `gate_passes_select` (002) shows an HOD only
//                `department_id in (select my_department_ids())`.
//   Person     — `.eq('raised_by', userId)`, in useHodBoardData.ts, on every
//                read. SERVER-side on purpose: filtering client-side would
//                download a colleague's passes in order to hide them.
import React, { useMemo, useState } from 'react';
import HodApprovalPending from '../../components/hod/HodApprovalPending';
import HodKpiCards from '../../components/hod/HodKpiCards';
import HodQuickActions from '../../components/hod/HodQuickActions';
import DepartmentDeleteRequests from '../../components/hod/DepartmentDeleteRequests';
import { formatDateOnly } from '../../lib/formatDate';
import { buildHodKpis, greetingFor, hodGreetingName } from '../../lib/hodBoard';
import { approvalWaiting } from '../../lib/hodApprovals';
import { useDepartmentDeleteRequests } from '../../lib/useDepartmentDeleteRequests';
import { useHodBoardData } from './useHodBoardData';

export default function Dashboard(): React.ReactElement {
  const { rows, approvals, name, loading, error } = useHodBoardData();
  // Stamped ONCE, at mount. A ticking clock would re-render four cards every
  // second for a greeting that changes twice a day and a date that changes once.
  const [stamp] = useState(() => Date.now());

  // The four offices on the Approval Pending strip at the foot of the page.
  // ONE PASS, ONE DESK — the same unit the Pending Approvals card above counts
  // in, so the strip sums to that card's own "N pending approval" line. It used
  // to count owed SIGNATURES, which made a single freshly raised pass read as
  // four things waiting (client, 2026-08-21: "it should match, right?").
  const officeWaiting = useMemo(() => approvalWaiting(rows, approvals), [rows, approvals]);
  const cards = useMemo(() => buildHodKpis(rows, stamp), [rows, stamp]);
  // AN ADMIN WANTING TO DELETE THIS PERSON'S DEPARTMENT (060). One more read,
  // and it draws nothing at all in the ordinary case where nothing is waiting —
  // which is why it sits above the figures rather than beside them: when it IS
  // there, it is the most consequential thing on the page.
  const { requests: deleteRequests, reload: reloadDeleteRequests } = useDepartmentDeleteRequests();

  return (
    <div className="gb-board gb-main">
      <div className="gb-head-row">
        <div className="min-w-0">
          <h1 className="gb-hello">
            {greetingFor(stamp)}, {hodGreetingName(name)}
          </h1>
          <p className="gb-sub">Here&rsquo;s what&rsquo;s happening with your passes today.</p>
        </div>
        {/* The mock draws a chevron here, implying a day picker. There is none:
            every figure on this page is either today or a running obligation,
            and a control that opens nothing is worse than no control. */}
        <span className="gb-stamp">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
            <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
          </svg>
          {formatDateOnly(new Date(stamp).toISOString())}
        </span>
      </div>

      {error && <div className="gb-alert">{error}</div>}

      <DepartmentDeleteRequests requests={deleteRequests} onDecided={reloadDeleteRequests} />

      {/* EVERY CARD IS A LINK, and its list is a page of its own —
          `/dashboard/<key>`, or `/overdue` for the item-level board (client,
          2026-08-23). Nothing opens under the row any more. */}
      <HodKpiCards cards={cards} loading={loading} />

      <div className="gb-stack">
        <HodQuickActions />
        <HodApprovalPending waiting={officeWaiting} />
      </div>
    </div>
  );
}
