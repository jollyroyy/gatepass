// THE STACK ITSELF — a list of `PassStackCard`s, and the token island they need.
//
// The cards are the guard skin's (`.gpo-*`), and that skin paints with the
// `--gb-*` custom properties. Those live on `.gb-board` and `.gb-main`, neither
// of which is on an HOD or admin page, so the stack carries `.gb-stack` — the
// same variables and a light `color-scheme`, and NOTHING else. It deliberately
// paints no ground of its own: the cards are white plates, and the page around
// them stays the house surface in whichever theme the reader chose.
import React from 'react';
import type { GatePassView } from '../types';
import PassStackCard from './PassStackCard';

type Props = {
  passes: GatePassView[];
  /** The admin keeps "Requested By"; the HOD raised these themselves. */
  showRaisedBy?: boolean;
  /** Numbers the cards from 1. Off for a list that is not a register. */
  numbered?: boolean;
  /** Controls for one card's right-hand side. Only the approver's queue passes
   *  this; every other stack stays action-free (see PassStackCard's header). */
  renderActions?: (pass: GatePassView) => React.ReactNode;
};

export default function PassStack({
  passes, showRaisedBy = true, numbered = true, renderActions,
}: Props): React.ReactElement {
  return (
    <div className="gb-stack">
      <ul className="gpo-stack" data-testid="pass-stack">
        {passes.map((p, i) => (
          <PassStackCard
            key={p.id}
            pass={p}
            index={numbered ? i + 1 : undefined}
            showRaisedBy={showRaisedBy}
            actions={renderActions ? renderActions(p) : undefined}
          />
        ))}
      </ul>
    </div>
  );
}
