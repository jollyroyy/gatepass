// The super admin's two summary cards — `GuardSummaryCards` in shape, figure
// for figure, with the admin's counts inside them (client, 2026-08-20: "follow
// the same dashboard look and feel of guard except the functionalities").
//
// ONE DIFFERENCE FROM THE GUARD'S, AND IT IS THE FUNCTIONALITY HALF. The
// guard's figures are `<Link>`s, because each one has a PAGE that lists exactly
// what it counted (`/pending-out`, `/pending-returns`). The admin has no such
// pages — its figures have always opened a stacked list in place, underneath —
// so these are `<button>`s that raise a `BoardDrill` instead. Making them links
// would mean inventing five admin list pages, or worse, sending a reader to a
// page that filters differently from the number they pressed.
//
// THE BOARD INVARIANT IS UNTOUCHED. Each figure hands back the very `BoardDrill`
// `buildOverviewCards` built for it, so the stack the press opens is the array
// the figure counted. Nothing here filters, and nothing here counts.
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
  /** The figure whose list is open, so the pressed one can say so. */
  openKey: string | null;
  onDrill: (group: SuperGroup, figureIndex: number) => void;
  loading: boolean;
};

export default function SuperSummaryCards({ groups, openKey, onDrill, loading }: Props): React.ReactElement {
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
                    {/* A figure with a destination is a LINK, not a button that
                        navigates: Overdue Returns opens `/overdue`, a page of
                        its own, so it must be middle-clickable and say where it
                        goes. Every other figure drills in place.
                        A figure that flashes a spinner on every silent refresh
                        is worse than one that shows a placeholder — the rule
                        every KPI in this app follows. */}
                    {f.to ? (
                      <Link to={f.to} className="gb-figure-value gb-figure-button">
                        {loading ? '—' : f.value.toLocaleString('en-IN')}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        className="gb-figure-value gb-figure-button"
                        aria-pressed={openKey === f.key}
                        onClick={() => onDrill(g, i)}
                      >
                        {loading ? '—' : f.value.toLocaleString('en-IN')}
                      </button>
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
