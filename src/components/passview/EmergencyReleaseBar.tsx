// THE BREAK-GLASS CONTROL, at the foot of the gate pass record (migration 055).
//
// WHO SEES IT. A super admin, on a pending pass that still owes at least one
// signature — and since 067 the sitting COO or CEO as well, on a pass that has
// STUCK: waited on its current rung longer than the escalation window.
// `canReleaseUnderEmergency` restates the RPC's own conditions so this is never
// drawn where `emergency_release_pass` would refuse the press. Everybody else,
// including an ordinary admin, gets nothing at all here.
//
// WHY IT IS NOT DRAWN AS A NORMAL ACTION. It sits under its own rule, in the
// danger hue, with the ladder's remaining offices named above it, because the
// admin should see exactly whose signatures they are about to skip while
// deciding to skip them. The press itself opens a modal that states the
// consequences and demands a written reason — the release is never one click.
//
// IT DOES NOT COMPETE WITH THE APPROVAL BAR. `ApprovalDecisionBar` is drawn for
// the office whose turn it is; this is drawn for a super admin regardless of
// whose turn it is. A super admin who also holds an office can see both, and
// that is correct: signing as the office is the right action and is offered
// first, with this underneath as the thing you do when nobody can.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';
import { APPROVAL_ROLE_TITLES, type ApprovalRoleKey } from '../../lib/approvalLadder';
import type { PassApprovalRow } from '../../lib/passApprovalState';
import { canReleaseUnderEmergency, releasePassUnderEmergency } from '../../lib/emergencyRelease';
import { useEscalationHours } from '../../lib/useEscalationHours';
import { safeErrorMessage } from '../../lib/errors';
import EmergencyReleaseModal from './EmergencyReleaseModal';

type Props = {
  pass: GatePassView;
  approvals: PassApprovalRow[];
  /** The reader's VMS role. `super_admin` gets this control unconditionally. */
  role: string | null;
  /** The approval office the reader holds, or null. The COO and the CEO carry
   *  the same power over a stuck pass (067) without holding the role. */
  office?: ApprovalRoleKey | null;
  /** Re-read the record — the ladder, the banner and the stage all change. */
  onReleased: () => void;
};

export default function EmergencyReleaseBar({
  pass, approvals, role, office = null, onReleased,
}: Props): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The admin's own window (063), which is also what "stuck" means (067). The
  // hook falls back to the shipped default, so a failed settings read still
  // judges this the way the RPC will.
  const escalationHours = useEscalationHours();

  const mayRelease = canReleaseUnderEmergency(pass.status, approvals, role, {
    office,
    approvals,
    passCreatedAt: pass.created_at,
    escalationHours,
  });
  if (!mayRelease) return null;

  const owed = approvals.filter((a) => a.status === 'pending');
  const names = owed
    .map((a) => APPROVAL_ROLE_TITLES[a.role_key as ApprovalRoleKey] ?? a.role_key)
    .join(', ');

  async function release(reason: string): Promise<void> {
    setError(null);
    try {
      await releasePassUnderEmergency(pass.id, reason);
      setOpen(false);
      onReleased();
    } catch (err) {
      // Rethrown so the modal keeps the typed reason and shows the sentence
      // itself; the copy here is only for a failure that closed the modal.
      setError(safeErrorMessage(err, 'Could not release that gate pass.'));
      throw err;
    }
  }

  return (
    <div data-testid="emergency-release" className="card p-4 border-flagged-300">
      <h2 className="card-title mb-1">Nobody can approve this?</h2>
      <p className="text-sm text-navy-500 mb-3">
        This pass is still waiting on <strong className="text-navy-700">{names}</strong>. If none of
        them can be reached and the material has to move, you can release it without their
        approval — in writing, and another admin will have to review it afterwards.
      </p>

      {error && <div className="alert-error mb-3">{error}</div>}

      <button type="button" className="btn-danger" onClick={() => setOpen(true)}>
        Release without approval
      </button>

      {open && (
        <EmergencyReleaseModal
          passNumber={pass.pass_number}
          owed={owed.length}
          onSubmit={release}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
