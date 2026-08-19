// APPROVAL PENDING — the mock-up's foot strip, kept exactly as drawn (client,
// 2026-08-19, asked and answered in the same pass).
//
// ALL FOUR FIGURES ARE HARD ZEROS AND WILL STAY ZERO until a real multi-level
// approval workflow exists in the database. The reason is in `hodApprovals.ts`,
// which owns the numbers; do not "fix" them here by counting some other queue,
// because every queue this app does have already has a card of its own above.
//
// There is deliberately NO "View all" link. The mock draws one; it would have to
// open a screen listing passes waiting at an approval level, and no such list
// can exist while no pass ever waits at one. A link to nowhere is worse than no
// link — the same rule that took the mock's fourth quick-action tile off the
// guard's board.
import React from 'react';
import { APPROVAL_SLOTS, APPROVAL_WAITING } from '../../lib/hodApprovals';
import HodIcon from './HodIcon';

export default function HodApprovalPending(): React.ReactElement {
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
              <span className="gb-approval-value">{APPROVAL_WAITING[s.key]}</span>
              <span className="gb-approval-note">Waiting</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
