// The CEO's decision on ONE whitelist request — Approve (two presses) and
// Reject (a written reason, refused blank before it reaches the server).
//
// It is a separate file because the request card is a disclosure now and the
// controls belong to the opened body alone; keeping both in one file put that
// file over the 300-line cap.
import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import { safeErrorMessage } from '../../lib/errors';

interface Props {
  requestId: string;
  onDecided: () => void;
  onError: (msg: string) => void;
}

export default function WhitelistDecisionControls({
  requestId, onDecided, onError,
}: Props): React.ReactElement {
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleApprove() {
    setBusy(true);
    try {
      const { error: err } = await gp().rpc('approve_whitelist_request', { p_id: requestId });
      if (err) throw err;
      setConfirmApprove(false);
      onDecided();
    } catch (err) {
      onError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleReject() {
    if (!rejectNote.trim()) {
      setRejectError('A reason is required.');
      return;
    }
    setBusy(true);
    try {
      const { error: err } = await gp().rpc('reject_whitelist_request', {
        p_id: requestId,
        p_note: rejectNote.trim(),
      });
      if (err) throw err;
      setShowReject(false);
      setRejectNote('');
      setRejectError(null);
      onDecided();
    } catch (err) {
      onError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pt-2 flex flex-col gap-2">
      <div className="flex gap-3 items-center">
        {confirmApprove ? (
          <span className="flex gap-2 items-center text-sm">
            <span className="text-navy-500">Sure?</span>
            <button
              type="button"
              className="text-matched-700 hover:text-matched-800 font-medium"
              disabled={busy}
              onClick={handleApprove}
            >
              Yes
            </button>
            <button type="button" className="text-navy-500 hover:text-navy-700" onClick={() => setConfirmApprove(false)}>
              No
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="btn-primary"
            disabled={busy}
            onClick={() => { setConfirmApprove(true); setShowReject(false); }}
          >
            Approve
          </button>
        )}

        {!showReject && (
          <button
            type="button"
            className="text-flagged-600 hover:text-flagged-800 text-sm font-medium"
            disabled={busy}
            onClick={() => { setShowReject(true); setConfirmApprove(false); }}
          >
            Reject
          </button>
        )}
      </div>

      {showReject && (
        <div className="flex flex-col gap-1">
          <textarea
            className="input w-full min-h-[60px]"
            placeholder="Reason for rejecting"
            value={rejectNote}
            onChange={(e) => { setRejectNote(e.target.value); setRejectError(null); }}
          />
          {rejectError && <p className="text-xs font-medium text-flagged-700">{rejectError}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn-primary" disabled={busy} onClick={handleReject}>
              {busy ? 'Rejecting…' : 'Submit Rejection'}
            </button>
            <button
              type="button"
              className="text-navy-500 hover:text-navy-700 text-sm"
              onClick={() => { setShowReject(false); setRejectNote(''); setRejectError(null); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
