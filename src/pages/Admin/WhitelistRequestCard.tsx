// One whitelist request — the vendor's justification is the point of this
// screen, so it is rendered in full, never truncated. Approve/Reject are
// visible only to the designated CEO; anyone else sees the record read-only.
import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import type { BlacklistType, WhitelistRequest, WhitelistRequestStatus } from '../../types';
import { formatDateTime } from '../../lib/formatDate';
import { safeErrorMessage } from '../../lib/errors';

const TYPE_STYLES: Record<BlacklistType, string> = {
  company: 'bg-red-50 text-red-700',
  vehicle: 'bg-orange-50 text-orange-700',
  driver: 'bg-yellow-50 text-yellow-700',
};

// 'company' reads as "Vendor" everywhere in the UI now — the stored label is
// unchanged (see BlacklistTab), and the two screens must not disagree about
// what the same row is called.
const TYPE_LABELS: Record<BlacklistType, string> = {
  company: 'Vendor',
  vehicle: 'Vehicle',
  driver: 'Driver',
};

const STATUS_STYLES: Record<WhitelistRequestStatus, string> = {
  pending: 'bg-pending-50 text-pending-700',
  approved: 'bg-matched-50 text-matched-700',
  rejected: 'bg-flagged-50 text-flagged-700',
};

const STATUS_LABELS: Record<WhitelistRequestStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

interface WhitelistRequestCardProps {
  request: WhitelistRequest;
  isCeo: boolean;
  onDecided: () => void;
  onError: (msg: string) => void;
}

export default function WhitelistRequestCard({
  request, isCeo, onDecided, onError,
}: WhitelistRequestCardProps): React.ReactElement {
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [rejectNote, setRejectNote] = useState('');
  const [rejectError, setRejectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleApprove() {
    setBusy(true);
    try {
      const { error: err } = await gp().rpc('approve_whitelist_request', { p_id: request.id });
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
        p_id: request.id,
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

  const isPending = request.status === 'pending';

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TYPE_STYLES[request.list_type]}`}>
            {TYPE_LABELS[request.list_type]}
          </span>
          <span className="font-semibold text-navy-900 text-base">{request.list_value}</span>
        </div>
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[request.status]}`}>
          {STATUS_LABELS[request.status]}
        </span>
      </div>

      <div className="text-sm text-navy-600">
        <span className="font-medium text-navy-700">Blocked because: </span>
        {request.blocked_reason}
      </div>

      <div className="text-sm text-navy-800">
        <span className="font-medium text-navy-700">Justification: </span>
        {request.justification}
      </div>

      <div className="text-xs text-navy-500">
        Requested by {request.requested_by_name ?? 'Unknown'} on {formatDateTime(request.requested_at)}
      </div>

      {!isPending && (
        <div className="text-xs text-navy-500">
          Decided by {request.decided_by_name ?? 'Unknown'} on {formatDateTime(request.decided_at)}
          {request.decision_note && (
            <div className="mt-1">
              <span className="font-medium text-navy-700">Note: </span>{request.decision_note}
            </div>
          )}
        </div>
      )}

      {isPending && isCeo && (
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
      )}
    </div>
  );
}
