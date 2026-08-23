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
import { Link } from 'react-router-dom';
import type { HodKpiCard } from '../../lib/hodBoard';
import HodIcon from './HodIcon';

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

/** The plate, the figure, the card's name, and the sub-lines under a hairline —
 *  identical whichever control wraps it. */
function Body({ card, loading }: { card: HodKpiCard; loading: boolean }): React.ReactElement {
  return (
    <>
      <span className="gb-kpi-head">
        <HodIcon glyph={card.glyph} tone={card.tone} />
        <span className="min-w-0">
          <span className="gb-kpi-figure">{loading ? '—' : card.value}</span>
          <span className="gb-kpi-name">{card.label}</span>
        </span>
      </span>

      {/* THE TWO DESKS UNDER THE TOTAL (client, 2026-08-23). They are READINGS,
          not controls — the whole card is already the control, and a button
          inside a button is not valid HTML — and the rule between them is the
          straight line the client asked for. They sum to the figure above by
          construction (`pendingSplit`), never by a predicate re-applied here. */}
      {card.notes && card.notes.length > 0 && (
        <span className="gb-kpi-notes">
          {card.notes.map((n, i) => (
            <React.Fragment key={n.key}>
              {i > 0 && <span className="gb-kpi-note-rule" aria-hidden="true" />}
              <span className="gb-kpi-note">
                <span className="gb-kpi-note-value">{loading ? '—' : n.value}</span>
                <span className="gb-kpi-note-label">{n.label}</span>
              </span>
            </React.Fragment>
          ))}
        </span>
      )}
    </>
  );
}

export default function HodKpiCards({ cards, activeKey, onSelect, loading }: Props): React.ReactElement {
  return (
    <div className="gb-kpi-grid" role="group" aria-label="Dashboard figures">
      {cards.map((c) => (
        // A CARD WITH A DESTINATION IS A LINK, not a button that navigates:
        // Overdue opens `/overdue`, a page of its own, so it must be
        // middle-clickable and it must say where it goes. Every other card
        // opens its list in place and stays a button.
        c.to ? (
          <Link key={c.key} to={c.to} className="gb-card gb-kpi">
            <Body card={c} loading={loading} />
          </Link>
        ) : (
          <button
            key={c.key}
            type="button"
            className="gb-card gb-kpi"
            aria-pressed={activeKey === c.key}
            onClick={() => onSelect(c)}
          >
            <Body card={c} loading={loading} />
          </button>
        )
      ))}
    </div>
  );
}
