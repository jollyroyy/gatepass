// THE PENDING OUT QUEUE AS THE GUARD READS IT ON A PHONE.
//
// The table (`PendingOutTable`) is eleven columns wide and Approve OUT is the
// eleventh. Inside `overflow-x: auto` on a 390px screen that button sits about
// 800px off the right edge — present in the DOM, unreachable in the hand of the
// person the app was built for (client, 2026-08-31: "approve out button is not
// appearing in mobile"). A guard standing at the barrier does not scroll a
// table sideways looking for a control.
//
// SO THE NARROW LAYOUT IS THE ONE STACKED CARD, not a second idiom: `PassStack`
// with each card carrying `matchAction` — the very function the global search
// results use, so "the action a pass in this state is offered" has ONE
// definition and Approve OUT one spelling. The cards unfold their own material
// lines, which is what the table's chevron row did.
//
// `showContext` names the department and purpose, because the table's own
// Department column is not on the card by default and the guard reads it.
import React from 'react';
import type { GatePassView } from '../../types';
import PassStack from '../PassStack';
import { matchAction } from './SearchMatches';

export default function PendingOutCards({ rows }: { rows: GatePassView[] }): React.ReactElement {
  return (
    <div data-testid="pending-out-cards" className="p-3">
      <PassStack
        passes={rows}
        expandable
        showContext
        renderActions={(p) => matchAction(p, true)}
      />
    </div>
  );
}
