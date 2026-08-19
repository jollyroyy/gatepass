// The two figures the whole guard board is about, side by side — drawn to the
// client's mock-up (2026-08-19): a big tinted disc, the panel's own name in its
// own colour, and the count underneath in near-black Inter.
//
// EVERY NUMBER IS DRILLABLE (client, 2026-08-19): clicking it opens the page
// that lists exactly the passes it counted. The dashboard stopped carrying the
// two preview tables on the same day, so the number is now the only way in and
// must be the way in — a figure a reader cannot open is a figure they cannot
// act on.
//
// AND IT STILL COUNTS WHAT THAT PAGE LISTS. The page derives its rows with the
// same predicate over the same query (`pendingOutOf` / `pendingReturnsOf` on
// `useGuardQueues`), so the card and the table it opens cannot disagree. The
// RGP and NRGP figures are a split of the ONE pending-OUT list (`typeSplit`),
// and each opens that page with its own tab already chosen.
import React from 'react';
import { Link } from 'react-router-dom';
import type { TypeSplit } from '../../lib/guardBoard';
import GuardIcon from './GuardIcon';

type Props = {
  split: TypeSplit;
  returnsDue: number;
  loading: boolean;
};

/** A figure that flashes a spinner on every silent refresh is worse than one
 *  that shows a placeholder, so `loading` renders a dash — the same rule every
 *  KPI on every board in this app follows. `label` is optional because the
 *  return card carries one count and the mock-up leaves it unlabelled. */
function Figure({ label, value, ink, loading, to }: {
  label?: string; value: number; ink?: string; loading: boolean; to: string;
}): React.ReactElement {
  return (
    <span className="gb-figure" data-testid={`guard-figure-${label ?? 'Due back'}`}>
      {label && <span className={`gb-figure-label ${ink ?? ''}`}>{label}</span>}
      <Link to={to} className="gb-figure-value">
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
            <Figure label="RGP" value={split.RGP} ink="gb-ink-orange" loading={loading}
                    to="/pending-out?type=RGP" />
            <span className="gb-figure-rule" aria-hidden="true" />
            <Figure label="NRGP" value={split.NRGP} ink="gb-ink-orange" loading={loading}
                    to="/pending-out?type=NRGP" />
          </div>
        </div>
      </div>

      <div className="gb-card gb-sum">
        <GuardIcon glyph="returned" tone="blue" />
        <div className="gb-sum-body">
          <h2 className="gb-sum-title gb-ink-blue">Pending RGP Return (Needs Verification)</h2>
          <div className="gb-figures">
            <Figure value={returnsDue} loading={loading} to="/pending-returns" />
          </div>
        </div>
      </div>
    </div>
  );
}
