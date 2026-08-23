// The guard's Dashboard: a greeting, the global search, two drillable figures
// and three quick actions.
//
// A FIGURE'S LIST IS A PAGE AGAIN — WITHOUT A TAB (client, 2026-08-23: "don't
// show the table on the same page. Show it on a different page, like you are
// showing the overdue details"). It opened in place here for a day; before that
// `/pending-out` and `/pending-returns` were routes with SIDEBAR TABS, and the
// tabs are what the client removed on 2026-08-22 ("there is no need to keep a
// separate tab on the right-hand side page. That would only show when the KPI
// cards have been drilled down from the guard's dashboard"). `/guard-dashboard/
// <key>` honours both: it is a page, and pressing its figure is the only way in.
// See `GuardDrill.tsx`; the panels themselves are
// `components/guard/PendingOutPanel` / `PendingReturnsPanel`.
//
// THE FIGURE AND ITS LIST ARE STILL ONE DERIVATION. Both screens read
// `useGuardQueues` once and cut it with the same `pendingOutOf` /
// `pendingReturnsOf` / `typeSplit`, so there is no second predicate that could
// make a count disagree with the table it opens.
//
// THE SEARCH MOVED UP HERE, and it is the guard's one search surface besides
// the `/console` route the Scan QR tile opens. It never narrowed either list —
// `useGateSearch` looks up a pass number over the WHOLE register and a mobile
// number over an unfiltered query — so drawing it once, above everything, is
// what it always wanted to be. While the viewfinder is open, or while a
// multi-pass mobile result is showing, the two summary cards stand
// down: a guard holding a slip up to a camera is not reading a queue, and the
// answer must not be pushed off screen by one.
//
// IT IS NOT PAINTED IN THE HOUSE THEME. The client asked (2026-08-19) for these
// screens to match their mock-up exactly — Inter headings in near-black, orange
// for the OUT queue, blue for the return queue, on a white ground — so every
// class here is a `.gb-*` from the scoped, fixed-light skin at the foot of
// src/index.css, and so is the drill page's.
import React, { useEffect, useState } from 'react';
import GuardSummaryCards from '../../components/guard/GuardSummaryCards';
import GuardToolbar from '../../components/guard/GuardToolbar';
import QuickActions from '../../components/guard/QuickActions';
import { useGuardSearch } from '../../components/guard/useGuardSearch';
import { formatDateTime } from '../../lib/formatDate';
import { firstNameOf, pendingOutOf, returnLinesOf, typeSplit } from '../../lib/guardBoard';
import { buildOverdueRows } from '../../lib/overdueItems';
import { fetchMyProfile } from '../../lib/profiles';
import { useGuardQueues } from '../../lib/useGuardQueues';

export default function GuardDashboard(): React.ReactElement {
  const { queue, openReturns, openItems, loading, error } = useGuardQueues('both');
  const [name, setName] = useState<string | null>(null);
  // Stamped once, at mount: a clock that ticks on a board nobody is watching
  // re-renders the page every second for a fact that changes by the minute.
  const [stamp] = useState(() => new Date().toISOString());

  const search = useGuardSearch(
    'Search by Pass No., Name, Vendor, Mobile No., Order No., Make / Model…'
  );

  // The greeting only. A profile that never resolves leaves "Hello, Guard",
  // which is what the board said before anyone was named — so this read has no
  // error surface of its own.
  useEffect(() => {
    let cancelled = false;
    fetchMyProfile()
      .then((p) => {
        if (!cancelled) setName(p?.full_name ?? null);
      })
      .catch(() => {
        /* the greeting falls back to "Guard" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const pendingOut = pendingOutOf(queue);
  // MATERIAL LINES, not passes (client, 2026-08-24). `returnLinesOf` is the
  // same derivation `GuardDrill` renders, so the figure is `rows.length` of the
  // very list pressing it opens.
  const returnLines = returnLinesOf(openReturns, openItems).length;

  // The one remaining Quick Action figure, built the way the page behind it
  // builds its rows: `/overdue` is `buildOverdueRows` over every open return.
  // Same function, same array — no second predicate to drift.
  const overdueLines = buildOverdueRows(openReturns, openItems).length;

  return (
    <div className="gb-board">
      <div className="gb-head-row">
        <div className="min-w-0">
          <h1 className="gb-hello">Hello, {firstNameOf(name)}</h1>
          <p className="gb-sub">
            Approve OUT for materials leaving and verify returns for RGP.
          </p>
        </div>
        <span className="gb-stamp">
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <rect x="3.75" y="5.25" width="16.5" height="15" rx="1.5" />
            <path strokeLinecap="round" d="M3.75 10.5h16.5M8.25 3.75v3M15.75 3.75v3" />
          </svg>
          {formatDateTime(stamp)}
        </span>
      </div>

      <GuardToolbar search={search.bar} />

      {search.notice}

      {error && <div className="gb-alert">{error}</div>}

      {search.scanning ? null : search.results ?? (
        <>
          <GuardSummaryCards
            split={typeSplit(pendingOut)}
            returnsDue={returnLines}
            loading={loading}
          />

          <QuickActions overdue={overdueLines} loading={loading} />
        </>
      )}
    </div>
  );
}
