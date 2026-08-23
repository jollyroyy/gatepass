// The four figures the HOD dashboard is about, drawn to the client's mock-up
// (2026-08-19): a tinted square plate, the figure in big near-black Inter, the
// card's name and its scope beside it, and one or two notes under a hairline.
//
// EVERY CARD IS A LINK NOW, AND ITS LIST IS A PAGE (client, 2026-08-23:
// "instead of showing it on the same page in the dashboard, show it on a new
// page for all the KPI cards … like you are showing the overdue details").
// Pressing a figure used to open the stacked list underneath it; the Overdue
// card alone navigated, and the client asked for every card to behave the way
// that one does. So there is no pressed state and no toggle here any more —
// each card carries a `to` and goes there: `/dashboard/<key>` for the four that
// list passes, `/overdue` for the item-level page.
//
// THE WHOLE CARD IS THE CONTROL, as before — a number this size with a hit area
// of two characters is a control nobody can press — and it is an anchor, so it
// is middle-clickable and says where it goes.
//
// AND IT STILL COUNTS WHAT THAT PAGE RENDERS. `buildHodKpis` hands each card its
// own rows on a `BoardDrill`; `/dashboard/<key>` rebuilds this very row from the
// same one read and renders that card's array. No aggregate, no `count:
// 'exact'`, no second predicate that could drift.
import React from 'react';
import { Link } from 'react-router-dom';
import type { HodKpiCard } from '../../lib/hodBoard';
import HodIcon from './HodIcon';

type Props = {
  cards: HodKpiCard[];
  /** A figure that flashes a spinner on every silent realtime refresh is worse
   *  than one that shows a placeholder, so loading renders an em dash — the same
   *  rule every KPI on every board in this app follows. */
  loading: boolean;
};

export default function HodKpiCards({ cards, loading }: Props): React.ReactElement {
  return (
    <div className="gb-kpi-grid" role="group" aria-label="Dashboard figures">
      {cards.map((card) => (
        <div key={card.key} className="gb-card gb-kpi">
          <Link to={card.to} className="gb-kpi-head gb-kpi-main">
            <HodIcon glyph={card.glyph} tone={card.tone} />
            <span className="min-w-0">
              <span className="gb-kpi-figure">{loading ? '—' : card.value}</span>
              <span className="gb-kpi-name">{card.label}</span>
            </span>
          </Link>

          {/* THE TWO DESKS UNDER EACH PASS TYPE (client, 2026-08-23), each a
              CONTROL of its own since the figure and its list stopped agreeing:
              as readings inside the card's anchor they opened the card's list,
              which is everything raised today whatever became of it. They still
              sum to that type's waiting set by construction (`pendingNotes`),
              never by a predicate re-applied here. */}
          {card.notes && card.notes.length > 0 && (
            <div className="gb-kpi-notes">
              {card.notes.map((n, i) => (
                <React.Fragment key={n.key}>
                  {i > 0 && <span className="gb-kpi-note-rule" aria-hidden="true" />}
                  <Link to={n.to} className="gb-kpi-note">
                    <span className="gb-kpi-note-value">{loading ? '—' : n.value}</span>
                    <span className="gb-kpi-note-label">{n.label}</span>
                  </Link>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
