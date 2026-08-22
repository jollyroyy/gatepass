// The guard's Dashboard — and since 2026-08-22 it is the guard's ONLY list
// screen: a greeting, the global search, two drillable figures, the list a
// pressed figure opens IN PLACE, and three quick actions.
//
// THE TWO LISTS ARE NOT PAGES ANY MORE. `/pending-out` and `/pending-returns`
// were routes with sidebar tabs of their own; the client removed both
// (2026-08-22): "make sure you don't keep any separate pending out or [RGP]
// tab — all those things are already there in the dashboard. All you have to do
// is just keep the entire page so that whenever somebody is clicking on the
// drill down on the KPI number, it would open up on the same page. There is no
// need to keep a separate tab on the right-hand side page. That would only show
// when the KPI cards have been drilled down from the guard's dashboard."
// `PendingOutPage.tsx` and `PendingReturnsPage.tsx` are DELETED, so a stale
// reference is a build error, and their bodies live on as
// `components/guard/PendingOutPanel` / `PendingReturnsPanel`.
//
// THE FIGURE AND ITS LIST ARE NOW ONE ARRAY. `useGuardQueues` is read once
// here; `pendingOutOf` / `pendingReturnsOf` derive the rows; the figure is
// `rows.length` and the panel is handed that very array. The board's oldest
// invariant used to be a promise two files kept separately — it is structural
// now.
//
// THE SEARCH MOVED UP HERE, and it is the guard's one search surface besides
// the `/console` route the Scan QR tile opens. It never narrowed either list —
// `useGateSearch` looks up a pass number over the WHOLE register and a mobile
// number over an unfiltered query — so drawing it once, above everything, is
// what it always wanted to be. While the viewfinder is open, or while a
// multi-pass mobile result is showing, the cards and the drilled list stand
// down: a guard holding a slip up to a camera is not reading a queue, and the
// answer must not be pushed off screen by one.
//
// IT IS NOT PAINTED IN THE HOUSE THEME. The client asked (2026-08-19) for these
// screens to match their mock-up exactly — Inter headings in near-black, orange
// for the OUT queue, blue for the return queue, on a white ground — so every
// class here is a `.gb-*` from the scoped, fixed-light skin at the foot of
// src/index.css.
import React, { useEffect, useState } from 'react';
import GuardSummaryCards, { type GuardDrillKey } from '../../components/guard/GuardSummaryCards';
import GuardToolbar from '../../components/guard/GuardToolbar';
import PendingOutPanel from '../../components/guard/PendingOutPanel';
import PendingReturnsPanel from '../../components/guard/PendingReturnsPanel';
import QuickActions from '../../components/guard/QuickActions';
import { useGuardSearch } from '../../components/guard/useGuardSearch';
import { formatDateTime } from '../../lib/formatDate';
import { firstNameOf, pendingOutOf, pendingReturnsOf, typeSplit } from '../../lib/guardBoard';
import { buildOverdueRows } from '../../lib/overdueItems';
import { fetchMyProfile } from '../../lib/profiles';
import { buildScheduledReturns } from '../../lib/scheduledReturns';
import { useScrollIntoViewOnChange } from '../../lib/useScrollIntoViewOnChange';
import { useGuardQueues } from '../../lib/useGuardQueues';

export default function GuardDashboard(): React.ReactElement {
  const { queue, openReturns, openItems, loading, error, reload } = useGuardQueues('both');
  const [name, setName] = useState<string | null>(null);
  const [drill, setDrill] = useState<GuardDrillKey | null>(null);
  // Stamped once, at mount: a clock that ticks on a board nobody is watching
  // re-renders the page every second for a fact that changes by the minute.
  const [stamp] = useState(() => new Date().toISOString());

  const search = useGuardSearch('Search by Pass No., Vendor, Mobile No.…');
  const drillRef = useScrollIntoViewOnChange<HTMLDivElement>(drill);

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
  const pendingReturns = pendingReturnsOf(openReturns);

  // The two Quick Action figures, each built the way the page behind it builds
  // its rows: `/returns` is `buildScheduledReturns` over the passes the
  // database grades `due_today`, `/overdue` is `buildOverdueRows` over every
  // open return. Same functions, same arrays — no second predicate to drift.
  const dueTodayLines = buildScheduledReturns(
    openReturns.filter((p) => p.due_state === 'due_today'),
    openItems
  ).length;
  const overdueLines = buildOverdueRows(openReturns, openItems).length;

  // Pressing the open figure closes it — the same toggle every drillable board
  // in this app uses.
  const onDrill = (key: GuardDrillKey): void =>
    setDrill((cur) => (cur === key ? null : key));

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
            returnsDue={pendingReturns.length}
            loading={loading}
            openKey={drill}
            onDrill={onDrill}
          />

          {/* The list a pressed figure opens, brought into view: a reader who
              pressed a figure should not have to hunt for where the answer
              appeared. Keyed on the drill, so moving from RGP to NRGP is a new
              question and starts with fresh filters and a fresh page. */}
          {drill && (
            <div ref={drillRef}>
              {drill === 'returns' ? (
                <PendingReturnsPanel rows={pendingReturns} loading={loading} onRecorded={reload} />
              ) : (
                <PendingOutPanel key={drill} rows={pendingOut} loading={loading} initialTab={drill} />
              )}
            </div>
          )}

          <QuickActions dueToday={dueTodayLines} overdue={overdueLines} loading={loading} />
        </>
      )}
    </div>
  );
}
