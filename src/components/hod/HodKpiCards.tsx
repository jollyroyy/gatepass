// The four figures the HOD dashboard is about, drawn to the client's mock-up
// (2026-08-19): a tinted square plate, the figure in big near-black Inter, the
// card's name and its scope beside it, and one or two notes under a hairline.
//
// EVERY FIGURE IS DRILLABLE (client, same instruction: "KPI counts should be
// drillable… once after the drill it should stack up the list of the respective
// passes"). The whole card is the button — a number this size with a hit area of
// two characters is a control nobody can press — and pressing it opens the
// stacked list of the very passes it counted, in place, directly underneath.
// Pressing the open card again closes it.
//
// AND IT STILL COUNTS WHAT THAT LIST RENDERS. `buildHodKpis` hands each card its
// own rows on a `BoardDrill`; the page passes that array straight to `DrillList`.
// No aggregate, no `count: 'exact'`, no second predicate that could drift.
import React from 'react';
import type { HodKpiCard } from '../../lib/hodBoard';
import HodIcon, { DOT } from './HodIcon';

type Props = {
  cards: HodKpiCard[];
  /** The key of the card whose list is open, or null. */
  activeKey: string | null;
  onSelect: (card: HodKpiCard) => void;
  /** A figure that flashes a spinner on every silent realtime refresh is worse
   *  than one that shows a placeholder, so loading renders an em dash — the same
   *  rule every KPI on every board in this app follows. */
  loading: boolean;
};

export default function HodKpiCards({ cards, activeKey, onSelect, loading }: Props): React.ReactElement {
  return (
    <div className="gb-kpi-grid" role="group" aria-label="Dashboard figures">
      {cards.map((c) => (
        <button
          key={c.key}
          type="button"
          className="gb-card gb-kpi"
          aria-pressed={activeKey === c.key}
          onClick={() => onSelect(c)}
        >
          <span className="gb-kpi-head">
            <HodIcon glyph={c.glyph} tone={c.tone} />
            <span className="min-w-0">
              <span className="gb-kpi-figure">{loading ? '—' : c.value}</span>
              <span className="gb-kpi-name">{c.label}</span>
              <span className="gb-kpi-scope">{c.sub}</span>
            </span>
          </span>

          {/* The hairline and its padding belong to the notes, so a card with
              none draws neither — an empty bordered strip under a figure reads
              as a line that failed to load. */}
          {c.notes.length > 0 && (
          <span className="gb-kpi-notes">
            {c.notes.map((n) => (
              <span key={n.text} className="gb-kpi-note">
                {n.dot && <span className={`gb-dot ${DOT[n.dot]}`} aria-hidden="true" />}
                {n.text}
              </span>
            ))}
          </span>
          )}
        </button>
      ))}
    </div>
  );
}
