// The super admin's two summary cards — `GuardSummaryCards` in shape, figure
// for figure, with the admin's counts inside them (client, 2026-08-20: "follow
// the same dashboard look and feel of guard except the functionalities").
//
// EVERY FIGURE IS A LINK, exactly as the guard's are (client, 2026-08-23: "show
// it on a new page for all the KPI cards"). They were buttons that opened a
// stacked list under the card; `/admin-dashboard/<key>` is that list as a page,
// and `/overdue` is the item-level board the Overdue figure always opened.
//
// THE BOARD INVARIANT IS UNTOUCHED. The page rebuilds the row from the same one
// read of `v_gate_passes`, over the same window (which rides on the URL), and
// renders the very array the figure counted. Nothing here filters, and nothing
// here counts.
//
// EVERY CLASS IS A `.gb-*`. This is the same scoped, fixed-light island the
// guard's board is drawn in, so no colour is introduced and `themeAudit` stays
// absolute over `src/components/**`.
import React from 'react';
import GuardIcon, { type GuardGlyph, type GuardTone } from '../guard/GuardIcon';
import { Link } from 'react-router-dom';
import type { SuperGroup, SuperGroupKey } from '../../lib/superAdminBoard';

/** The plate each card wears. A `Record` over the group union, so a third card
 *  cannot be added without somebody choosing its colour on purpose. The two are
 *  the guard board's own pairing: blue for the steady reading, orange for the
 *  one that means somebody has work to do. */
const PLATE: Record<SuperGroupKey, { glyph: GuardGlyph; tone: GuardTone }> = {
  raised: { glyph: 'exchange', tone: 'blue' },
  attention: { glyph: 'alert', tone: 'orange' },
};

const INK: Record<SuperGroupKey, string> = {
  raised: 'gb-ink-blue',
  attention: 'gb-ink-orange',
};

type Props = {
  groups: SuperGroup[];
  /** The window the board is showing, carried into the drill page's URL so the
   *  page counts the same days the figure did. */
  days: number;
  loading: boolean;
};

export default function SuperSummaryCards({ groups, days, loading }: Props): React.ReactElement {
  return (
    <div className="gb-grid-2">
      {groups.map((g) => (
        <div key={g.key} className="gb-card gb-sum" data-testid={`super-card-${g.key}`}>
          <GuardIcon glyph={PLATE[g.key].glyph} tone={PLATE[g.key].tone} />
          <div className="gb-sum-body">
            <h2 className={`gb-sum-title ${INK[g.key]}`}>{g.title}</h2>
            <div className="gb-figures">
              {g.figures.map((f, i) => (
                <React.Fragment key={f.key}>
                  {i > 0 && <span className="gb-figure-rule" aria-hidden="true" />}
                  <span className="gb-figure">
                    <span className={`gb-figure-label ${INK[g.key]}`}>{f.label}</span>
                    {/* A LINK, never a button that navigates: the list is a
                        page of its own, so a figure must be middle-clickable
                        and must say where it goes. The window rides on the URL
                        for the windowed figures; `/overdue` is running and
                        would be lying if it claimed a range.
                        A figure that flashes a spinner on every silent refresh
                        is worse than one that shows a placeholder — the rule
                        every KPI in this app follows. */}
                    <Link
                      to={f.drill ? `${f.to}?days=${days}` : f.to}
                      className="gb-figure-value gb-figure-button"
                    >
                      {loading ? '—' : f.value.toLocaleString('en-IN')}
                    </Link>
                    {/* The two desks under a pass-type figure (client,
                        2026-08-23) — readings, not controls: an anchor inside
                        an anchor is not valid HTML. */}
                    {f.notes && f.notes.length > 0 && (
                      <span className="gb-figure-notes">
                        {f.notes.map((n) => (
                          <span key={n.key} className="gb-figure-note">
                            <span className="gb-figure-note-value">{loading ? '—' : n.value}</span>
                            {n.label}
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
