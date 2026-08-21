// APPROVAL PENDING — the mock-up's foot strip. Its four figures are real
// (migration 046): each is how many of THIS HOD's passes that office is
// currently holding up — one pass counted once, against the one desk that can
// act on it. See `src/lib/hodApprovals.ts` for the office mapping, for why
// "HOD Approval" alone stays structurally zero, and for why counting every
// owed SIGNATURE (which is what this strip did until 2026-08-21) both
// disagreed with the Pending Approvals card above and named offices that
// cannot yet see the document.
//
// THE FOUR FIGURES SUM TO THAT CARD'S "N pending approval" LINE, by
// construction — the client asked for the two to match, and they are the same
// set of passes counted two ways. The rest of the card's figure is at the
// GATE, which is not an approver and has no slot here.
//
// `waiting` is a prop, not an import: the page reads `pass_approvals` once
// and derives the map with `approvalWaiting`.
//
// There is deliberately NO "View all" link. The mock draws one; this page's
// own drillable KPI cards already open the very passes an office is waiting
// on — Security/Finance/Other approvals only ever apply to a pass this HOD
// raised, and every such pass is already one card-press away above this
// strip. A second link to the same passes would be a control that duplicates
// one already on the page.
import React from 'react';
import { APPROVAL_SLOTS, type ApprovalOffice } from '../../lib/hodApprovals';
import HodIcon from './HodIcon';

type Props = {
  waiting: Record<ApprovalOffice, number>;
};

export default function HodApprovalPending({ waiting }: Props): React.ReactElement {
  return (
    <div className="gb-card gb-approvals">
      <div className="gb-approvals-head">
        <HodIcon glyph="hourglass" tone="purple" shape="chip" />
        <span className="min-w-0">
          <h2 className="gb-quick-title">Approval Pending</h2>
          <span className="gb-approvals-sub">Passes waiting for approval from other approvers.</span>
        </span>
      </div>

      <div className="gb-approvals-grid">
        {APPROVAL_SLOTS.map((s) => (
          <div key={s.key} className="gb-approval">
            <HodIcon glyph={s.glyph} tone={s.tone} shape="chip" />
            <span className="min-w-0">
              <span className="gb-approval-label">{s.label}</span>
              <span className="gb-approval-value">{waiting[s.key]}</span>
              <span className="gb-approval-note">Waiting</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
