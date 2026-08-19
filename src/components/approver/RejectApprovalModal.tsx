// "Reject Request" — the mock-up's modal (2026-08-19, migration 046).
//
// A rejection CANNOT BE UNDONE: `reject_pass_level` closes the whole pass
// (`status` becomes `cancelled`) the moment it runs, so this is the one
// control on the screen that gets a modal rather than a single press — the
// same reasoning `AddReturnBox`'s two-step commit and every destructive
// confirmation in this app follow.
//
// The house `.modal-overlay` / `.modal-content` classes, not `.gb-*`: this
// modal can be triggered from a page that already opts into the light `.gb-*`
// skin, but a modal is its own layer above the page and the house classes
// already carry both themes correctly (see ModalShell).
import React, { useState } from 'react';
import ModalShell from '../ModalShell';
import { safeErrorMessage } from '../../lib/errors';

const MAX_REASON = 500;

type Props = {
  passNumber: string;
  /** Submits the trimmed reason. Throws on failure — the modal shows the
   *  message and stays open so the reason is not lost. */
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
};

export default function RejectApprovalModal({ passNumber, onSubmit, onClose }: Props): React.ReactElement {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();

  async function submit(): Promise<void> {
    if (trimmed.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not reject that request.'));
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={submitting ? () => undefined : onClose} labelledBy="reject-approval-title">
      <h2 id="reject-approval-title" className="modal-title mb-1">
        Reject Request
      </h2>
      <p className="text-sm text-navy-500 mb-5">Pass ID: {passNumber}</p>

      <div className="mb-1">
        <label className="label" htmlFor="reject-reason">
          Reason for Rejection *
        </label>
        <textarea
          id="reject-reason"
          className="input"
          rows={4}
          maxLength={MAX_REASON}
          value={reason}
          disabled={submitting}
          placeholder="Please provide a reason for rejecting this gate pass request..."
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <p className="text-xs text-navy-500 mb-4 text-right">
        {reason.length}/{MAX_REASON}
      </p>

      {error && <div className="alert-error mb-4">{error}</div>}

      <div className="flex flex-col-reverse md:flex-row gap-3">
        <button type="button" className="btn-secondary flex-1" onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-danger flex-1"
          onClick={() => void submit()}
          disabled={submitting || trimmed.length === 0}
        >
          {submitting ? 'Submitting…' : 'Submit Rejection'}
        </button>
      </div>
    </ModalShell>
  );
}
