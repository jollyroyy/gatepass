// Approve / Reject actions for a flagged pass, shown only to the HOD who raised
// it (guard enforced by the caller). Reject is final — the pass becomes
// `cancelled` and can never be verified at the gate — so it requires an inline
// confirmation panel rather than firing on a single click. Never
// window.confirm: it blocks the page and breaks automation.
import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import { safeErrorMessage } from '../../lib/errors';

interface FlaggedReviewActionsProps {
  passId: string;
  onDone: () => void;
  onError: (message: string) => void;
}

export default function FlaggedReviewActions({
  passId,
  onDone,
  onError,
}: FlaggedReviewActionsProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  async function approve() {
    setBusy(true);
    try {
      const { error: rpcErr } = await gp().rpc('hod_review_flagged_pass', {
        p_pass_id: passId,
        p_action: 'approve',
      });
      if (rpcErr) throw rpcErr;
      onDone();
    } catch (err) {
      onError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirmReject() {
    setBusy(true);
    try {
      const trimmed = reason.trim();
      const { error: rpcErr } = await gp().rpc('hod_review_flagged_pass', {
        p_pass_id: passId,
        p_action: 'reject',
        p_reason: trimmed || null,
      });
      if (rpcErr) throw rpcErr;
      onDone();
    } catch (err) {
      onError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-3 mt-1 border border-flagged-500/30 rounded-xl p-4 bg-flagged-500/5">
        <p className="text-sm font-semibold text-flagged-700">
          This is final. The pass will be closed and the material will not be released.
        </p>
        <div className="flex flex-col gap-1">
          <label htmlFor="reject-reason" className="text-xs font-bold text-navy-400 uppercase tracking-wider">
            Reason (optional)
          </label>
          <textarea
            id="reject-reason"
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-danger" onClick={confirmReject} disabled={busy}>
            Confirm Rejection
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              setConfirming(false);
              setReason('');
            }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-primary" onClick={approve} disabled={busy}>
        Approve Override
      </button>
      <button type="button" className="btn-danger" onClick={() => setConfirming(true)} disabled={busy}>
        Reject Pass
      </button>
    </div>
  );
}
