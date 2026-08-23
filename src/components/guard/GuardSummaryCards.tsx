// The two figures the whole guard board is about, side by side — drawn to the
// client's mock-up (2026-08-19): a big tinted disc, the panel's own name in its
// own colour, and the count underneath in near-black Inter.
//
// EVERY NUMBER IS DRILLABLE, AND SINCE 2026-08-23 ITS LIST IS A PAGE (client:
// "don't show the table on the same page. Show it on a different page, like you
// are showing the overdue details"). The figures drilled in place for a day;
// before that they were `<Link>`s to `/pending-out` and `/pending-returns`,
// which were pages WITH SIDEBAR TABS. The tabs are what the client removed on
// 2026-08-22 and they are not coming back: `/guard-dashboard/<key>` is reachable
// only by pressing the figure that counts it.
//
// AND IT STILL COUNTS WHAT IT OPENS. `GuardDrill` rebuilds the queues from the
// same `useGuardQueues` read and derives them with the same `pendingOutOf` /
// `pendingReturnsOf` / `typeSplit`, so the figure and the table cannot disagree
// — there is no second predicate anywhere. The RGP and NRGP figures are a split
// of the ONE pending-OUT list, and each opens that list with its own tab already
// chosen.
import React from 'react';
import { Link } from 'react-router-dom';
import type { TypeSplit } from '../../lib/guardBoard';
import GuardIcon from './GuardIcon';

/** Which page a figure opens. `RGP` and `NRGP` open the same panel on different
 *  tabs; `returns` opens the return queue. A union rather than a string, so a
 *  fourth figure cannot be drilled without somebody deciding what it opens —
 *  `GuardDrill`'s own `Record` is keyed by these three. */
export type GuardDrillKey = 'RGP' | 'NRGP' | 'returns';

type Props = {
  split: TypeSplit;
  /** MATERIAL LINES due back today, not passes (client, 2026-08-24) — see
   *  `returnLinesOf`. Four lines across two RGPs is "4" here and four rows on
   *  the page it opens. */
  returnsDue: number;
  loading: boolean;
};

/** A figure that flashes a spinner on every silent refresh is worse than one
 *  that shows a placeholder, so `loading` renders a dash — the same rule every
 *  KPI on every board in this app follows. `label` is optional because the
 *  return card carries one count and the mock-up leaves it unlabelled. */
function Figure({ label, value, ink, loading, drill }: {
  label?: string; value: number; ink?: string; loading: boolean; drill: GuardDrillKey;
}): React.ReactElement {
  return (
    <span className="gb-figure" data-testid={`guard-figure-${label ?? 'Due back'}`}>
      {label && <span className={`gb-figure-label ${ink ?? ''}`}>{label}</span>}
      {/* A LINK, not a button that navigates: the list is a page of its own, so
          the figure must be middle-clickable and must say where it goes. */}
      <Link to={`/guard-dashboard/${drill}`} className="gb-figure-value gb-figure-button">
        {loading ? '—' : value}
      </Link>
    </span>
  );
}

export default function GuardSummaryCards({ split, returnsDue, loading }: Props): React.ReactElement {
  return (
    <div className="gb-grid-2">
      <div className="gb-card gb-sum">
        <GuardIcon glyph="truck" tone="orange" />
        <div className="gb-sum-body">
          <h2 className="gb-sum-title gb-ink-orange">Pending OUT (Needs Approval)</h2>
          <div className="gb-figures">
            <Figure label="RGP" value={split.RGP} ink="gb-ink-orange" loading={loading} drill="RGP" />
            <span className="gb-figure-rule" aria-hidden="true" />
            <Figure label="NRGP" value={split.NRGP} ink="gb-ink-orange" loading={loading} drill="NRGP" />
          </div>
        </div>
      </div>

      <div className="gb-card gb-sum">
        <GuardIcon glyph="returned" tone="blue" />
        <div className="gb-sum-body">
          <h2 className="gb-sum-title gb-ink-blue">Pending RGP Return (Needs Verification)</h2>
          <div className="gb-figures">
            <Figure value={returnsDue} loading={loading} drill="returns" />
            <span className="gb-figure-unit">
              {returnsDue === 1 ? 'item' : 'items'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
