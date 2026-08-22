// The two figures the whole guard board is about, side by side — drawn to the
// client's mock-up (2026-08-19): a big tinted disc, the panel's own name in its
// own colour, and the count underneath in near-black Inter.
//
// EVERY NUMBER IS DRILLABLE, AND SINCE 2026-08-22 IT DRILLS IN PLACE. The
// figures used to be `<Link>`s to `/pending-out` and `/pending-returns`; the
// client removed both pages and both sidebar tabs ("there is no need to keep a
// separate tab … that would only show when the KPI cards have been drilled down
// from the guard's dashboard"), so these are `<button>`s that open the list
// directly underneath, on this page. That is the same shape the admin's and the
// super admin's boards have always had — see `SuperSummaryCards`, whose
// `.gb-figure-button` styling this reuses.
//
// AND IT STILL COUNTS WHAT IT OPENS — structurally now, rather than by two
// files keeping the same promise: the dashboard hands the panel the very array
// it counted (`pendingOutOf` / `pendingReturnsOf` over one `useGuardQueues`
// read), so the card and the table under it cannot disagree. The RGP and NRGP
// figures are a split of the ONE pending-OUT list (`typeSplit`), and each opens
// that list with its own tab already chosen.
import React from 'react';
import type { TypeSplit } from '../../lib/guardBoard';
import GuardIcon from './GuardIcon';

/** Which list is open. `RGP` and `NRGP` open the same panel on different tabs;
 *  `returns` opens the return queue. A union rather than a string, so a fourth
 *  figure cannot be drilled without somebody deciding what it opens. */
export type GuardDrillKey = 'RGP' | 'NRGP' | 'returns';

type Props = {
  split: TypeSplit;
  returnsDue: number;
  loading: boolean;
  /** The figure whose list is open, so the pressed one can say so. */
  openKey: GuardDrillKey | null;
  onDrill: (key: GuardDrillKey) => void;
};

/** A figure that flashes a spinner on every silent refresh is worse than one
 *  that shows a placeholder, so `loading` renders a dash — the same rule every
 *  KPI on every board in this app follows. `label` is optional because the
 *  return card carries one count and the mock-up leaves it unlabelled. */
function Figure({ label, value, ink, loading, drill, openKey, onDrill }: {
  label?: string; value: number; ink?: string; loading: boolean;
  drill: GuardDrillKey; openKey: GuardDrillKey | null; onDrill: (key: GuardDrillKey) => void;
}): React.ReactElement {
  return (
    <span className="gb-figure" data-testid={`guard-figure-${label ?? 'Due back'}`}>
      {label && <span className={`gb-figure-label ${ink ?? ''}`}>{label}</span>}
      <button
        type="button"
        className="gb-figure-value gb-figure-button"
        aria-pressed={openKey === drill}
        onClick={() => onDrill(drill)}
      >
        {loading ? '—' : value}
      </button>
    </span>
  );
}

export default function GuardSummaryCards({
  split, returnsDue, loading, openKey, onDrill,
}: Props): React.ReactElement {
  return (
    <div className="gb-grid-2">
      <div className="gb-card gb-sum">
        <GuardIcon glyph="truck" tone="orange" />
        <div className="gb-sum-body">
          <h2 className="gb-sum-title gb-ink-orange">Pending OUT (Needs Approval)</h2>
          <div className="gb-figures">
            <Figure label="RGP" value={split.RGP} ink="gb-ink-orange" loading={loading}
                    drill="RGP" openKey={openKey} onDrill={onDrill} />
            <span className="gb-figure-rule" aria-hidden="true" />
            <Figure label="NRGP" value={split.NRGP} ink="gb-ink-orange" loading={loading}
                    drill="NRGP" openKey={openKey} onDrill={onDrill} />
          </div>
        </div>
      </div>

      <div className="gb-card gb-sum">
        <GuardIcon glyph="returned" tone="blue" />
        <div className="gb-sum-body">
          <h2 className="gb-sum-title gb-ink-blue">Pending RGP Return (Needs Verification)</h2>
          <div className="gb-figures">
            <Figure value={returnsDue} loading={loading}
                    drill="returns" openKey={openKey} onDrill={onDrill} />
          </div>
        </div>
      </div>
    </div>
  );
}
