// The Overview's five figures, drawn to the client's mock-up (2026-08-19):
// a round tinted plate, the card's name in small grey Inter, the figure in big
// near-black, and under it the change against the previous window.
//
// EVERY CARD IS A LINK, AND ITS LIST IS A PAGE (client, 2026-08-23: "instead of
// showing it on the same page in the dashboard, show it on a new page for all
// the KPI cards"). The whole card is the control — a number this size with a hit
// area of two characters is a control nobody can press — and it is an anchor, so
// it is middle-clickable and says where it goes. There is no pressed state and
// no toggle here any more.
//
// AND IT STILL COUNTS WHAT THE PAGE RENDERS. `/admin-dashboard/<key>` rebuilds
// this row from the same one read of `v_gate_passes`, over the same window, and
// renders that card's own `drill.rows` — no aggregate, no second predicate.
//
// THE TWO DESK LINES under the pass-type cards are READINGS, not controls: an
// anchor inside an anchor is not valid HTML, and the card's own page is what
// opens. They sum to that type's waiting set by construction (`pendingNotes`).
//
// NO CARD COMPARES ITSELF TO ANYTHING (client, 2026-08-19: "remove all those
// comparisons"). The mock's red/green "18.6% vs last week" arrow is DELETED —
// the arrow glyphs, the direction ink and the `Delta` type with them, so a stale
// reference is a build error. The second line is now the card's scope in plain
// grey words, on all five, which is what keeps the row one height.
import React from 'react';
import { Link } from 'react-router-dom';
import type { OverviewCard } from '../../lib/adminOverview';
import HodIcon from '../hod/HodIcon';

type Props = {
  cards: OverviewCard[];
  /** The window the board is showing, carried into the drill page's URL so the
   *  page it opens counts the same days the figure did. `/overdue` is running,
   *  not windowed, and takes none. */
  days: number;
  /** A figure that flashes a spinner on every silent realtime refresh is worse
   *  than one that shows a placeholder, so loading renders an em dash — the same
   *  rule every KPI on every board in this app follows. */
  loading: boolean;
};

export default function OverviewCards({ cards, days, loading }: Props): React.ReactElement {
  return (
    <div className="gb-ov-grid" role="group" aria-label="Overview figures">
      {cards.map((c) => (
        <Link
          key={c.key}
          // The window rides on the URL for the cards whose figure is windowed;
          // `/overdue` counts a running obligation and would be lying if it
          // claimed a range.
          to={c.drill ? `${c.to}?days=${days}` : c.to}
          className="gb-card gb-ov"
        >
          <span className="gb-ov-head">
            <HodIcon glyph={c.glyph} tone={c.tone} shape="round" />
            <span className="min-w-0">
              <span className="gb-ov-label">{c.label}</span>
              <span className="gb-ov-figure">{loading ? '—' : c.value.toLocaleString('en-IN')}</span>
            </span>
          </span>

          {c.notes && c.notes.length > 0 && (
            <span className="gb-kpi-notes">
              {c.notes.map((n, i) => (
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
        </Link>
      ))}
    </div>
  );
}
