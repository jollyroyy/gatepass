// The two figures the whole guard board is about, side by side.
//
// EVERY NUMBER HERE IS `rows.length` OF THE PANEL BELOW IT — the page filters
// once, hands the arrays down, and these cards count what is already on screen.
// The RGP and NRGP figures are a split of the ONE pending-OUT list, so they sum
// to the rows under them by construction (`typeSplit`).
//
// The chevron scrolls to that panel rather than navigating: a guard is standing
// at a barrier with a truck waiting, and a page load between the number and the
// list it stands for is a page load too many.
import React from 'react';
import type { Tone } from '../KpiCard';
import { TONE_TEXT } from '../KpiCard';
import type { TypeSplit } from '../../lib/guardBoard';
import GuardIcon from './GuardIcon';

type Props = {
  split: TypeSplit;
  returnsDue: number;
  loading: boolean;
  onOpenOut: () => void;
  onOpenReturns: () => void;
};

/** A figure that flashes a spinner on every silent refresh is worse than one
 *  that shows a placeholder, so `loading` renders a dash — the same rule every
 *  KPI on every board in this app follows. */
function Figure({ label, value, tone, loading }: {
  label: string; value: number; tone: Tone; loading: boolean;
}): React.ReactElement {
  return (
    <span className="flex flex-col gap-1 min-w-0" data-testid={`guard-figure-${label}`}>
      <span className="kpi-label">{label}</span>
      <span className={`kpi-value ${TONE_TEXT[tone]}`}>{loading ? '—' : value}</span>
    </span>
  );
}

function Chevron({ label, onClick }: { label: string; onClick: () => void }): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="h-11 w-11 rounded-xl shrink-0 flex items-center justify-center
                 bg-surface-100 text-navy-600 hover:bg-surface-200 active:scale-[0.98]
                 transition-all duration-200"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

export default function GuardSummaryCards({
  split, returnsDue, loading, onOpenOut, onOpenReturns,
}: Props): React.ReactElement {
  return (
    <div className="grid gap-4 lg:grid-cols-2 mb-6">
      <div className="card p-5 flex items-center gap-4">
        <GuardIcon glyph="truck" tone="pending" large />
        <div className="min-w-0 flex-1">
          <h2 className="board-section-title">Pending OUT (Needs Approval)</h2>
          <div className="mt-3 flex items-center gap-6">
            <Figure label="RGP" value={split.RGP} tone="pending" loading={loading} />
            <span className="w-px self-stretch bg-surface-200" aria-hidden="true" />
            <Figure label="NRGP" value={split.NRGP} tone="neutral" loading={loading} />
          </div>
        </div>
        <Chevron label="Go to the pending OUT list" onClick={onOpenOut} />
      </div>

      <div className="card p-5 flex items-center gap-4">
        <GuardIcon glyph="returned" tone="accent" large />
        <div className="min-w-0 flex-1">
          <h2 className="board-section-title">Pending RGP Return (Needs Verification)</h2>
          <div className="mt-3">
            <Figure label="Due back" value={returnsDue} tone="accent" loading={loading} />
          </div>
        </div>
        <Chevron label="Go to the pending RGP return list" onClick={onOpenReturns} />
      </div>
    </div>
  );
}
