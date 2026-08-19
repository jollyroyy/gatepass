// The two figures the whole guard board is about, side by side — drawn to the
// client's mock-up (2026-08-19): a big tinted disc, the panel's own name in
// its own colour, and the count underneath in near-black Inter.
//
// EVERY NUMBER HERE IS `rows.length` OF THE PANEL BELOW IT — the page filters
// once, hands the arrays down, and these cards count what is already on screen.
// The RGP and NRGP figures are a split of the ONE pending-OUT list, so they sum
// to the rows under them by construction (`typeSplit`).
//
// THERE IS NO CHEVRON. It used to scroll to the matching panel; the client
// removed it (2026-08-19) — the panel it pointed at is directly underneath on
// every width, so the control was a button to scroll one screen.
import React from 'react';
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
function Figure({ label, value, ink, loading }: {
  label?: string; value: number; ink?: string; loading: boolean;
}): React.ReactElement {
  return (
    <span className="gb-figure" data-testid={`guard-figure-${label ?? 'Due back'}`}>
      {label && <span className={`gb-figure-label ${ink ?? ''}`}>{label}</span>}
      <span className="gb-figure-value">{loading ? '—' : value}</span>
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
            <Figure label="RGP" value={split.RGP} ink="gb-ink-orange" loading={loading} />
            <span className="gb-figure-rule" aria-hidden="true" />
            <Figure label="NRGP" value={split.NRGP} ink="gb-ink-orange" loading={loading} />
          </div>
        </div>
      </div>

      <div className="gb-card gb-sum">
        <GuardIcon glyph="returned" tone="blue" />
        <div className="gb-sum-body">
          <h2 className="gb-sum-title gb-ink-blue">Pending RGP Return (Needs Verification)</h2>
          <div className="gb-figures">
            <Figure value={returnsDue} loading={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
