// Confirm panel for an HOD permanently deleting their own still-pending pass.
// Split out of MyPasses.tsx to keep that file under the 300-line rule — same
// pattern as VoidPassPanel.tsx.
import React from 'react';
import type { GatePassView } from '../../types';

interface DeletePassPanelProps {
  pass: GatePassView;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeletePassPanel({
  pass,
  submitting,
  error,
  onCancel,
  onConfirm,
}: DeletePassPanelProps): React.ReactElement {
  return (
    <div className="modal-overlay">
      <div className="modal-content p-6">
        <h2 className="text-lg font-bold text-navy-950 mb-1">Delete {pass.pass_number}</h2>
        <p className="text-sm text-navy-500 mb-2">
          This permanently removes the pass. It cannot be undone and leaves no record.
        </p>
        <p className="text-sm text-navy-500 mb-2">
          Pass number {pass.pass_number} will be skipped in the sequence.
        </p>
        <p className="text-sm text-navy-500 mb-5">
          If the slip has already been printed and handed over, void it instead — a guard scanning a
          deleted pass sees only &quot;not found&quot;, with no explanation.
        </p>

        {error && <div className="alert-error mb-4">{error}</div>}

        <div className="flex flex-col-reverse md:flex-row gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel} disabled={submitting}>
            Keep Pass
          </button>
          <button type="button" className="btn-danger flex-1" disabled={submitting} onClick={onConfirm}>
            {submitting ? 'Deleting…' : 'Delete Permanently'}
          </button>
        </div>
      </div>
    </div>
  );
}
