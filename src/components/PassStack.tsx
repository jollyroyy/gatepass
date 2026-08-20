// THE STACK ITSELF — a list of `PassStackCard`s, and the token island they need.
//
// The cards are the guard skin's (`.gpo-*`), and that skin paints with the
// `--gb-*` custom properties. Those live on `.gb-board` and `.gb-main`, neither
// of which is on an HOD or admin page, so the stack carries `.gb-stack` — the
// same variables and a light `color-scheme`, and NOTHING else. It deliberately
// paints no ground of its own: the cards are white plates, and the page around
// them stays the house surface in whichever theme the reader chose.
import React, { useState } from 'react';
import type { GatePassView } from '../types';
import PassStackCard from './PassStackCard';

type Props = {
  passes: GatePassView[];
  /** The admin keeps "Requested By"; the HOD raised these themselves. */
  showRaisedBy?: boolean;
  /** Numbers the cards from 1. Off for a list that is not a register. */
  numbered?: boolean;
  /** Names each pass's department and purpose among its facts. Only the
   *  approver's board asks for it — see `PassStackCard`. */
  showContext?: boolean;
  /** Controls for one card's right-hand side. Only the approver's queue passes
   *  this; every other stack stays action-free (see PassStackCard's header). */
  renderActions?: (pass: GatePassView) => React.ReactNode;
  /** Lets a card unfold its own material lines (client, 2026-08-20). The OPEN
   *  card is held here rather than in each card, because "one at a time" is a
   *  fact about the list: a page of twenty passes must not end up with twenty
   *  item queries alive at once. */
  expandable?: boolean;
};

export default function PassStack({
  passes, showRaisedBy = true, showContext = false, numbered = true, renderActions,
  expandable = false,
}: Props): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="gb-stack">
      <ul className="gpo-stack" data-testid="pass-stack">
        {passes.map((p, i) => (
          <PassStackCard
            key={p.id}
            pass={p}
            index={numbered ? i + 1 : undefined}
            showRaisedBy={showRaisedBy}
            showContext={showContext}
            actions={renderActions ? renderActions(p) : undefined}
            expandable={expandable}
            open={expandable && openId === p.id}
            onToggle={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
          />
        ))}
      </ul>
    </div>
  );
}
