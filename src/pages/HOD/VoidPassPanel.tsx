// Confirm panel for an HOD cancelling their own still-pending pass. Split out of
// MyPasses.tsx to keep that file under the 300-line rule — same pattern as
// VerifyPanels.tsx being split out of Verify.tsx.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';

interface VoidPassPanelProps {
  pass: GatePassView;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export default function VoidPassPanel({
  pass,
  submitting,
  error,
  onCancel,
  onConfirm,
}: VoidPassPanelProps): React.ReactElement {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0;

  return (
    <div className="modal-overlay">
      <div className="modal-content p-6">
        <h2 className="text-lg font-bold text-navy-950 mb-1">Cancel {pass.pass_number}</h2>
        <p className="text-sm text-navy-500 mb-5">
          This withdraws the pass before it reaches the gate and cannot be undone. Raise a new pass if the
          material still needs to move.
        </p>

        <div className="mb-5">
          <label className="label">Reason for cancelling</label>
          <textarea
            className="input"
            rows={4}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Raised for the wrong department by mistake."
          />
        </div>

        {error && <div className="alert-error mb-4">{error}</div>}

        <div className="flex flex-col-reverse md:flex-row gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel} disabled={submitting}>
            Keep Pass
          </button>
          <button
            type="button"
            className="btn-danger flex-1"
            disabled={submitting || !valid}
            onClick={() => onConfirm(reason.trim())}
          >
            {submitting ? 'Cancelling…' : 'Confirm Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
