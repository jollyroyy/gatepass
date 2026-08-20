// THE THREE FIGURES over "Whitelist of Vendors" (client, 2026-08-20).
//
// NONE OF THEM IS A CONTROL, and that is deliberate. The very rows each one
// counts are in the list directly underneath it, already grouped — there is
// nothing for a click to open. That is the same call the report's KPI row
// made, and it is why these are `<div>`s rather than the `<button>` the
// overdue board's `.gpo-total` was written as.
//
// A ZERO CARD STAYS ON SCREEN saying zero rather than vanishing, with its own
// sentence under it: a figure that disappears when it reaches nothing is a
// figure nobody can trust at a glance.
//
// The skin is `.gpo-*`, which paints from the `--gb-*` vars declared on
// `.gb-board` / `.gb-main` / `.gb-stack`. Both callers are inside one — the
// admin panel rides `.gb-main` on `<main>`, and the CEO's `/whitelist` page is
// its own `.gb-board gb-main` island — so no colour is introduced here and
// `themeAudit` stays absolute.
import React from 'react';
import type { WhitelistKpi } from '../../lib/whitelistCounts';
import GuardIcon from '../../components/guard/GuardIcon';

type Props = { cards: WhitelistKpi[] };

export default function WhitelistKpiCards({ cards }: Props): React.ReactElement {
  return (
    <div className="gpo-total-row" role="group" aria-label="Whitelist figures" data-testid="whitelist-kpis">
      {cards.map((c) => (
        <div key={c.key} className={`gpo-total ${c.skin}`.trim()}>
          <GuardIcon glyph={c.glyph} tone={c.tone} shape="square" />
          <span className="gpo-total-body">
            <span className="gpo-total-title">{c.title}</span>
            <span className="gpo-total-figure">{c.value}</span>
            <span className="gpo-total-note">{c.note}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
