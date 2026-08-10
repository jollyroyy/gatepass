import React, { useState } from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import ModalShell from '../../components/ModalShell';

interface LineQty {
  item_id: string;
  description: string;
  declared_qty: number;
  verified_qty: number;
}

interface MatchPanelProps {
  pass: GatePassView;
  items: GatePassItemView[];
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (lines: { item_id: string; verified_qty: number }[], vehicle: string, remarks: string) => void;
}

export function MatchPanel({ pass, items, submitting, error, onCancel, onConfirm }: MatchPanelProps): React.ReactElement {
  const [lines, setLines] = useState<LineQty[]>(() =>
    items.map((i) => ({
      item_id: i.id,
      description: i.description,
      declared_qty: i.quantity,
      verified_qty: i.quantity,
    }))
  );
  const [vehicle, setVehicle] = useState(pass.vehicle_number ?? '');
  const [remarks, setRemarks] = useState('');

  function updateLineQty(itemId: string, value: string) {
    const qty = Number(value);
    setLines((prev) =>
      prev.map((l) => (l.item_id === itemId ? { ...l, verified_qty: Number.isNaN(qty) ? 0 : qty } : l))
    );
  }

  function handleConfirm() {
    const allValid = lines.every((l) => l.verified_qty > 0);
    if (!allValid) return;
    onConfirm(
      lines.map((l) => ({ item_id: l.item_id, verified_qty: l.verified_qty })),
      vehicle.trim(),
      remarks.trim()
    );
  }

  return (
    <ModalShell onClose={onCancel} labelledBy="match-panel-title">
        <h2 id="match-panel-title" className="text-h2 text-navy-950 mb-1">Confirm Match</h2>
        <p className="text-sm text-navy-500 mb-5">Verify each item's quantity at the gate, then confirm.</p>

        <div className="flex flex-col gap-4 mb-5">
          <div className="border border-surface-300 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-100 text-navy-600 text-xs uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Item</th>
                  <th className="text-right px-3 py-2 w-28">Declared</th>
                  <th className="text-right px-3 py-2 w-28">Counted</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.item_id} className="border-t border-surface-200">
                    <td className="px-3 py-2 text-navy-900 font-medium">{l.description}</td>
                    <td className="px-3 py-2 text-right text-navy-500 tabular">{l.declared_qty}</td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        className="input text-right w-full"
                        value={l.verified_qty || ''}
                        onChange={(e) => updateLineQty(l.item_id, e.target.value)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
            disabled={submitting || lines.some((l) => l.verified_qty <= 0)}
            onClick={handleConfirm}
          >
            {submitting ? 'Confirming…' : '✓ Confirm Match'}
          </button>
        </div>
    </ModalShell>
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
    <ModalShell onClose={onCancel} labelledBy="flag-panel-title">
        <h2 id="flag-panel-title" className="text-h2 text-navy-950 mb-1">Report Mismatch</h2>
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
            {submitting ? 'Submitting…' : '⚑ Confirm Mismatch'}
          </button>
        </div>
    </ModalShell>
  );
}
