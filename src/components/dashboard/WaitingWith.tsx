// WAITING WITH — the strip at the foot of the admin and HOD dashboards
// (client, 2026-08-20: "in the dashboard you need to mention at the bottom how
// many are waiting for which person").
//
// ONE COMPONENT FOR BOTH BOARDS, because the question is the same one and a
// second copy is a second thing to change. Both are the `.gb-*` island, so it
// draws in the mock-ups' palette with the same `HodIcon` chips the Approval
// Pending strip beside it uses.
//
// IT SAYS ITS OWN SCOPE OUT LOUD, AND THAT SCOPE IS NO LONGER A DAY (client,
// 2026-08-21: "it should not be only the passes which were raised today, but
// all the passes which are pending for all those approvals accordingly … remove
// the today word from the bottom from the admin view"). The word "today" is
// therefore gone from every sentence here — including the empty one, which said
// it too. What is left is WHOSE passes are counted, which still differs between
// the two boards and is the caller's to state.
//
// NO CONTROL OF ANY KIND. It is a reading, not a drill: the passes it counts
// are the ones the cards above already open, and a second route to the same
// list is a control that duplicates one already on the page — the same call the
// Approval Pending strip made.
import React from 'react';
import HodIcon from '../hod/HodIcon';
import type { HodGlyph, HodTone } from '../hod/hodIconTypes';
import { GATE_KEY, waitingPersonLabel, waitingWithTotal, type WaitingRow } from '../../lib/waitingWith';

/** A glyph and a tone per desk. `Record`-keyed on the row's own union, so a
 *  fifth office is a type error rather than an unstyled chip. */
const DESK: Record<WaitingRow['key'], { glyph: HodGlyph; tone: HodTone }> = {
  security_head: { glyph: 'shield', tone: 'blue' },
  coo: { glyph: 'people', tone: 'purple' },
  finance_head: { glyph: 'wallet', tone: 'orange' },
  ceo: { glyph: 'people', tone: 'green' },
  [GATE_KEY]: { glyph: 'shield', tone: 'red' },
};

type Props = {
  rows: WaitingRow[];
  /** "your passes" on the HOD board, "all departments" on the admin's — the
   *  strip counts what its board was handed and must not imply otherwise. */
  scopeNote: string;
};

export default function WaitingWith({ rows, scopeNote }: Props): React.ReactElement {
  const total = waitingWithTotal(rows);

  return (
    <div className="gb-card gb-approvals">
      <div className="gb-approvals-head">
        <HodIcon glyph="hourglass" tone="orange" shape="chip" />
        <span className="min-w-0">
          <h2 className="gb-quick-title">Waiting With</h2>
          <span className="gb-approvals-sub">
            {total === 0
              ? `Nothing is waiting — ${scopeNote}.`
              : `${total} ${total === 1 ? 'pass' : 'passes'} waiting on these desks — ${scopeNote}.`}
          </span>
        </span>
      </div>

      <div className="gb-approvals-grid gb-waiting-grid">
        {rows.map((r) => (
          <div key={r.key} className="gb-approval">
            <HodIcon glyph={DESK[r.key].glyph} tone={DESK[r.key].tone} shape="chip" />
            <span className="min-w-0">
              <span className="gb-approval-label">{r.office}</span>
              <span className="gb-approval-value">{r.count}</span>
              <span className="gb-approval-note">{waitingPersonLabel(r)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
