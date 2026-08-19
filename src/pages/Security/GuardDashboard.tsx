// The guard's Dashboard — TWO DRILLABLE FIGURES, A GREETING AND THREE QUICK
// ACTIONS (client, 2026-08-19, second revision of the mock-up).
//
// The two lists that used to sit under the cards are GONE FROM HERE and are
// pages of their own: `/pending-out` and `/pending-returns`. The client asked
// for the number to be the way in — "when the guard clicks on the drillable
// number it should directly take him to that particular page" — and a
// five-row preview above a page holding the same rows is a second, shorter
// answer to the same question, which is how a preview and its page start
// disagreeing.
//
// THE FIGURES STILL COUNT WHAT THOSE PAGES LIST. `useGuardQueues` is the same
// hook both pages call, `pendingOutOf` / `pendingReturnsOf` the same predicates:
// no aggregate, no `count: 'exact'`, no second predicate that could drift.
//
// IT IS NOT PAINTED IN THE HOUSE THEME. The client asked (2026-08-19) for these
// screens to match their mock-up exactly — Inter headings in near-black, orange
// for the OUT queue, blue for the return queue, on a white ground — so every
// class here is a `.gb-*` from the scoped, fixed-light skin at the foot of
// src/index.css. Nothing else in the app uses those classes, and the gold
// heading ladder is untouched everywhere else.
import React, { useEffect, useState } from 'react';
import GuardSummaryCards from '../../components/guard/GuardSummaryCards';
import QuickActions from '../../components/guard/QuickActions';
import { formatDateTime } from '../../lib/formatDate';
import { firstNameOf, pendingOutOf, pendingReturnsOf, typeSplit } from '../../lib/guardBoard';
import { buildOverdueRows } from '../../lib/overdueItems';
import { fetchMyProfile } from '../../lib/profiles';
import { buildScheduledReturns } from '../../lib/scheduledReturns';
import { useGuardQueues } from '../../lib/useGuardQueues';

export default function GuardDashboard(): React.ReactElement {
  const { queue, openReturns, openItems, loading, error } = useGuardQueues('both');
  const [name, setName] = useState<string | null>(null);
  // Stamped once, at mount: a clock that ticks on a board nobody is watching
  // re-renders the page every second for a fact that changes by the minute.
  const [stamp] = useState(() => new Date().toISOString());

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

      {error && <div className="gb-alert">{error}</div>}

      <GuardSummaryCards
        split={typeSplit(pendingOut)}
        returnsDue={pendingReturns.length}
        loading={loading}
      />

      <QuickActions dueToday={dueTodayLines} overdue={overdueLines} loading={loading} />
    </div>
  );
}
