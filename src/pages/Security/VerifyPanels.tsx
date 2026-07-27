// Confirm panels for the Verify decision screen. Split out of Verify.tsx to keep
// that file focused on the read layout and stay under the 300-line rule.
//
// A discrepancy the guard notices must be *captured*, not silently accepted —
// that is why Match still opens a panel instead of firing immediately.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';

interface MatchPanelProps {
  pass: GatePassView;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (quantity: number, vehicle: string, remarks: string) => void;
}

export function MatchPanel({ pass, submitting, error, onCancel, onConfirm }: MatchPanelProps): React.ReactElement {
  const [quantity, setQuantity] = useState(String(pass.quantity));
  const [vehicle, setVehicle] = useState(pass.vehicle_number ?? '');
  const [remarks, setRemarks] = useState('');

  const qtyNum = Number(quantity);
  const valid = quantity.trim() !== '' && !Number.isNaN(qtyNum) && qtyNum > 0;

  return (
    <div className="modal-overlay">
      <div className="modal-content p-6">
        <h2 className="text-lg font-bold text-navy-950 mb-1">Confirm Match</h2>
        <p className="text-sm text-navy-500 mb-5">Record what you actually counted at the gate.</p>

        <div className="flex flex-col gap-4 mb-5">
          <div>
            <label className="label">Actual quantity counted</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="input text-lg"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="label">Actual vehicle number</label>
            <input className="input text-lg" value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
          </div>
          <div>
            <label className="label">Remarks (optional)</label>
            <textarea className="input" rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </div>
        </div>

        {error && <div className="alert-error mb-4">{error}</div>}

        <div className="flex flex-col-reverse md:flex-row gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-match flex-1"
            disabled={submitting || !valid}
            onClick={() => onConfirm(qtyNum, vehicle.trim(), remarks.trim())}
          >
            {submitting ? 'Confirming…' : '✓ Confirm Match'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface FlagPanelProps {
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

export function FlagPanel({ submitting, error, onCancel, onConfirm }: FlagPanelProps): React.ReactElement {
  const [reason, setReason] = useState('');
  const valid = reason.trim().length > 0;

  return (
    <div className="modal-overlay">
      <div className="modal-content p-6">
        <h2 className="text-lg font-bold text-navy-950 mb-1">Flag Mismatch</h2>
        <p className="text-sm text-navy-500 mb-5">Describe what doesn&apos;t match. This is required.</p>

        <div className="mb-5">
          <label className="label">What doesn&apos;t match?</label>
          <textarea
            className="input"
            rows={4}
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Vehicle number does not match the declared vehicle."
          />
        </div>

        {error && <div className="alert-error mb-4">{error}</div>}

        <div className="flex flex-col-reverse md:flex-row gap-3">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-flag flex-1"
            disabled={submitting || !valid}
            onClick={() => onConfirm(reason.trim())}
          >
            {submitting ? 'Flagging…' : '⚑ Confirm Flag'}
          </button>
        </div>
      </div>
    </div>
  );
}
