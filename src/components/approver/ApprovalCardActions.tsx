// APPROVE / REJECT ON THE STACKED CARD ITSELF (client, 2026-08-20: "on the
// right-hand side he can click on approve or reject, and rejection also should
// come with a mandatory justification" · "as simple, clear and minimal as
// possible — in the main section only the pending approvals and the action
// button").
//
// THIS REVERSES THE 2026-08-19 RULE that a stacked card carries no control at
// all. It is narrowed to exactly one caller: `PassStackCard` draws actions only
// when a list hands it some, so every OTHER stack in this app — the admin's
// drills, the HOD's register, the overdue board — is unchanged and still
// action-free. Read `PassStackCard`'s header before widening this.
//
// The record's own bar (`ApprovalDecisionBar`) stays exactly as it is: an
// office holder can still open the pass, read every line, and sign at the foot
// of it. The two go through the SAME `approvalActions.ts` wrappers — never the
// RPCs directly — so both send the next office's letter.
//
// APPROVE SITS FIRST, REJECT SECOND (client, 2026-08-20). It is the ordinary
// outcome, and the destructive one is the one that should take a beat longer to
// reach for.
//
// A rejection is irreversible (046 closes the pass), so it opens the same
// 500-character `RejectApprovalModal` the record uses. Approve is one press:
// it moves the pass forward and nothing is destroyed.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';
import { approvePass, rejectPass } from '../../lib/approvalActions';
import { safeErrorMessage } from '../../lib/errors';
import RejectApprovalModal from './RejectApprovalModal';

type Props = {
  pass: GatePassView;
  /** Re-read the queue. Only the database knows whether this press was the
   *  pass's last level, so the list is re-read and never patched. */
  onDecided: () => void;
};

export default function ApprovalCardActions({ pass, onDecided }: Props): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function approve(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await approvePass(pass.id);
      onDecided();
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not record that decision.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="gpo-act-group">
      <div className="gpo-act-row">
        <button
          type="button"
          className="gpo-act gpo-act-approve"
          disabled={busy}
          onClick={() => void approve()}
        >
          {busy ? 'Working…' : 'Approve'}
        </button>
        <button
          type="button"
          className="gpo-act gpo-act-reject"
          disabled={busy}
          onClick={() => setRejecting(true)}
        >
          Reject
        </button>
      </div>
      {error && <span className="gpo-act-error">{error}</span>}

      {rejecting && (
        <RejectApprovalModal
          passNumber={pass.pass_number}
          onClose={() => setRejecting(false)}
          onSubmit={async (reason) => {
            await rejectPass(pass.id, reason);
            setRejecting(false);
            onDecided();
          }}
        />
      )}
    </div>
  );
}
