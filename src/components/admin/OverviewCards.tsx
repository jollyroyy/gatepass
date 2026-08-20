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
// NO CARD COMPARES ITSELF TO ANYTHING (client, 2026-08-19: "remove all those
// comparisons"). The mock's red/green "18.6% vs last week" arrow is DELETED —
// the arrow glyphs, the direction ink and the `Delta` type with them, so a stale
// reference is a build error. The second line is now the card's scope in plain
// grey words, on all five, which is what keeps the row one height.
import React from 'react';
import type { OverviewCard } from '../../lib/adminOverview';
import HodIcon, { DOT } from '../hod/HodIcon';

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

          <span className="gb-ov-delta gb-ov-none">{c.note}</span>

          {/* THE SUB-FIGURES (client, 2026-08-20), on Pending Approvals alone.
              The hairline and its padding belong to the notes, so a card with
              none draws neither — an empty bordered strip under a figure reads
              as a line that failed to load. They are readings and not controls:
              the whole card is already the drill button, and a button inside a
              button is not valid HTML. */}
          {c.notes.length > 0 && (
            <span className="gb-ov-notes">
              {c.notes.map((n) => (
                <span key={n.key} className="gb-ov-note">
                  <span className={`gb-dot ${DOT[n.tone]}`} aria-hidden="true" />
                  {loading ? '—' : n.text}
                </span>
              ))}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
