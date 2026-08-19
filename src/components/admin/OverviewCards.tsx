// The Overview's five figures, drawn to the client's mock-up (2026-08-19):
// a round tinted plate, the card's name in small grey Inter, the figure in big
// near-black, and under it the change against the previous window.
//
// EVERY FIGURE IS DRILLABLE, and the WHOLE CARD is the button — a number this
// size with a hit area of two characters is a control nobody can press.
// Pressing it opens the stacked list of the very passes it counted, in place
// directly underneath; pressing the open card closes it. `buildOverviewCards`
// hands each card its own rows on a `BoardDrill` and the page passes that array
// straight to `DrillList`, so no aggregate and no second predicate can drift.
//
// THE DELTA IS A REAL MEASUREMENT OR IT IS NOT DRAWN. Three cards compare their
// window against the one immediately before it. The two RUNNING queues —
// Pending Approvals, Overdue Returns — carry no delta at all: nothing in this
// database records how long a queue was a week ago, and the mock's red arrow is
// not worth inventing one for. Their slot takes the plain grey scope line
// instead, so the row still reads as five cards of one height.
import React from 'react';
import type { OverviewCard } from '../../lib/adminOverview';
import HodIcon from '../hod/HodIcon';

const ARROW: Record<'up' | 'down' | 'flat', string> = {
  up: 'M12 5.5l5 5.5h-3.2v7h-3.6v-7H7z',
  down: 'M12 18.5l-5-5.5h3.2v-7h3.6v7H17z',
  // A flat window still gets a mark rather than an empty box: "no change" is a
  // measurement, and a blank reads as a figure that failed to load.
  flat: 'M6 10.5h12v3H6z',
};

/** Direction as INK. Up is not automatically good here — more overdue returns is
 *  worse — but the two figures where the sign would mislead carry no delta at
 *  all, so on the three that remain, up is growth and green is honest. */
const DELTA_INK: Record<'up' | 'down' | 'flat', string> = {
  up: 'gb-ov-up',
  down: 'gb-ov-down',
  flat: 'gb-ov-flat',
};

type Props = {
  cards: OverviewCard[];
  /** The key of the card whose list is open, or null. */
  activeKey: string | null;
  onSelect: (card: OverviewCard) => void;
  /** A figure that flashes a spinner on every silent realtime refresh is worse
   *  than one that shows a placeholder, so loading renders an em dash — the same
   *  rule every KPI on every board in this app follows. */
  loading: boolean;
};

export default function OverviewCards({ cards, activeKey, onSelect, loading }: Props): React.ReactElement {
  return (
    <div className="gb-ov-grid" role="group" aria-label="Overview figures">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          className="gb-card gb-ov"
          aria-pressed={activeKey === c.key}
          onClick={() => onSelect(c)}
        >
          <span className="gb-ov-head">
            <HodIcon glyph={c.glyph} tone={c.tone} shape="round" />
            <span className="min-w-0">
              <span className="gb-ov-label">{c.label}</span>
              <span className="gb-ov-figure">{loading ? '—' : c.value.toLocaleString('en-IN')}</span>
            </span>
          </span>

          {c.delta ? (
            <span className={`gb-ov-delta ${DELTA_INK[c.delta.direction]}`}>
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={ARROW[c.delta.direction]} />
              </svg>
              {c.delta.pct}% {c.note}
            </span>
          ) : (
            <span className="gb-ov-delta gb-ov-none">{c.note}</span>
          )}
        </button>
      ))}
    </div>
  );
}
