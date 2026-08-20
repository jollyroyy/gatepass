// "Release without the remaining approvals" — the modal behind migration 055.
//
// IT STATES THE CONSEQUENCES BEFORE THE PRESS, because this is the one control
// in the app that skips a control rather than exercising one. The reason typed
// here is copied onto every level it clears, printed permanently on the record,
// and shown to a second admin who has to review it — and saying all of that on
// the screen is what makes an admin type a real sentence instead of "urgent".
//
// THE 10-CHARACTER FLOOR IS THE DATABASE'S, restated so the button can be
// disabled with the shortfall visible. `emergency_release_pass` refuses a
// shorter reason outright; being told no after writing is worse than being told
// what is needed while writing.
//
// House `.modal-overlay` / `.modal-content` through ModalShell, exactly as
// RejectApprovalModal — a modal is its own layer above whatever skin the page
// underneath opted into.
import React, { useState } from 'react';
import ModalShell from '../ModalShell';
import { safeErrorMessage } from '../../lib/errors';
import { EMERGENCY_REASON_MAX, EMERGENCY_REASON_MIN, isReasonWritten } from '../../lib/emergencyRelease';

type Props = {
  passNumber: string;
  /** How many offices still owe a signature — the number this release clears. */
  owed: number;
  /** Submits the trimmed reason. Throws on failure; the modal shows the message
   *  and stays open so a carefully written reason is never lost. */
  onSubmit: (reason: string) => Promise<void>;
  onClose: () => void;
};

export default function EmergencyReleaseModal({
  passNumber, owed, onSubmit, onClose,
}: Props): React.ReactElement {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = reason.trim();
  const ready = isReasonWritten(trimmed);
  const short = EMERGENCY_REASON_MIN - trimmed.length;

  async function submit(): Promise<void> {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(safeErrorMessage(err, 'Could not release that gate pass.'));
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={submitting ? () => undefined : onClose} labelledBy="emergency-release-title">
      <h2 id="emergency-release-title" className="modal-title mb-1">
        Release without the remaining approvals
      </h2>
      <p className="text-sm text-navy-500 mb-4">Pass ID: {passNumber}</p>

      <div className="alert-warning mb-4">
        This clears {owed === 1 ? 'the one approval' : `all ${owed} approvals`} this pass still
        owes, so it can leave the gate without them. The pass will show
        permanently that it was released under emergency, this reason will be
        printed on it, everyone on the ladder will be emailed, and another admin
        has to review it afterwards.
      </div>

      <div className="mb-1">
        <label className="label" htmlFor="emergency-reason">
          Why is this being released? *
        </label>
        <textarea
          id="emergency-reason"
          className="input"
          rows={4}
          maxLength={EMERGENCY_REASON_MAX}
          value={reason}
          disabled={submitting}
          placeholder="Name who was contacted, why they could not approve, and who authorised this…"
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
      <p className="text-xs text-navy-500 mb-4 flex justify-between gap-3">
        <span>{ready ? '' : `${short} more character${short === 1 ? '' : 's'} needed`}</span>
        <span>{reason.length}/{EMERGENCY_REASON_MAX}</span>
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
          disabled={!ready || submitting}
        >
          {submitting ? 'Releasing…' : 'Release this pass'}
        </button>
      </div>
    </ModalShell>
  );
}
