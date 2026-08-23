// WHAT A SEARCH FINDS WHEN IT FINDS MORE THAN ONE PASS.
//
// A pass number identifies one pass. A mobile number, a name, a vendor, a
// requester, an order number or a make and model identify a SET of them — "the
// same vendor can have multiple passes … maybe five passes in for Dell"
// (client, 2026-08-24) — so the answer is a list, and it is drawn in the ONE
// stacked card format the guard's boards already use (`PassStack`), not in a
// table of its own. Two idioms for one kind of answer was the thing the client
// removed everywhere else; this was the last table that had not followed.
//
// EVERY CARD CARRIES THE ACTION ITS OWN STATE ALLOWS, and it is the SAME action
// the drilled KPI list would offer for that pass:
//   * waiting at the gate  → **Approve OUT**, straight to `/verify/:id`, the
//     same `ApproveOutAction` the Pending OUT list draws, gated on the same
//     `canVerifyAtGate` — which is `match_pass`'s own rule, so a button that
//     could only fail is never drawn;
//   * still owing material → **Record Return**, to the pass's record, which is
//     where `apply_item_returns` is reachable for a return of ANY date. The
//     drilled return list only holds what is due today; a search can surface a
//     pass due next month, and sending it to a list that would not show it is
//     worse than sending it to the record that will take it.
//   * anything else        → **View pass**.
//
// THE CARDS UNFOLD (`expandable`), because half these queries are about the
// material rather than the pass: someone searching "Latitude 5440" wants to see
// which line matched without opening five records.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import PassStack from '../PassStack';
import { canVerifyAtGate } from '../../lib/phoneSearch';
import ApproveOutAction from './ApproveOutAction';

const ReturnGlyph = (
  <svg
    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
  >
    <path d="M9 14l-5-5 5-5" />
    <path d="M4 9h9a7 7 0 010 14H8" />
  </svg>
);

/** Still owes material, so the gate's next act on it is recording a return.
 *  `partially_returned` counts — one line back out of three is not closure. */
function owesReturn(p: GatePassView): boolean {
  return p.return_status === 'awaiting_return' || p.return_status === 'partially_returned';
}

/** The one control a card gets. Never two: a pass waiting at the gate has not
 *  left yet and therefore owes nothing back. */
export function matchAction(pass: GatePassView, canAct: boolean): React.ReactElement {
  if (canAct && canVerifyAtGate(pass)) return <ApproveOutAction id={pass.id} />;
  if (canAct && owesReturn(pass)) {
    return (
      <Link to={`/pass/${pass.id}`} className="gb-action gb-action-blue">
        {ReturnGlyph}
        Record Return
      </Link>
    );
  }
  return (
    <Link to={`/pass/${pass.id}`} className="gb-action">
      View pass
    </Link>
  );
}

type Props = {
  /** What was typed, echoed in the heading so the reader knows what these are
   *  an answer to. */
  query: string;
  rows: GatePassView[];
  onClear: () => void;
  /** False on a screen where the reader cannot act at the gate. The gate's own
   *  screens are guard-only by route, so this is defence in depth rather than
   *  the authorisation — `match_pass` and `apply_item_returns` are. */
  canAct?: boolean;
};

export default function SearchMatches({
  query, rows, onClear, canAct = true,
}: Props): React.ReactElement {
  return (
    <section className="gb-card gb-panel" data-testid="guard-search-results">
      <div className="gb-panel-head">
        <h2 className="gb-panel-title">
          {query} — {rows.length} {rows.length === 1 ? 'pass' : 'passes'}
        </h2>
        <button type="button" className="gb-link" onClick={onClear}>
          Clear search
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="gb-empty">
          No gate pass matches that pass number, mobile number, name, vendor,
          requester, order number or make and model.
        </div>
      ) : (
        <PassStack
          passes={rows}
          expandable
          renderActions={(p) => matchAction(p, canAct)}
        />
      )}
    </section>
  );
}
