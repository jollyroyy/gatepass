// The two confirm popups behind the guard's gate decision.
//
// Client, 2026-08-20: the guard's screen says APPROVE and REJECT — never
// "Match", "Mismatch" or "Hold". The RPCs behind them are unchanged
// (`match_pass` and `flag_pass`); only the words the guard reads changed. The reason
// on a rejection is MANDATORY, and the 500-character box is the same one the
// approval ladder's RejectApprovalModal uses, so every written refusal in this
// app is the same shape of field.
//
// AND ON 2026-08-31 IT WENT BACK TO "REJECT PASS", because the thing it does
// changed. Between 2026-08-23 and then it read "Flag to Requester", which was
// the honest description of a transition that HANDED THE PASS BACK: the raising
// HOD either upheld the flag or sent the pass to this gate again. The client
// has removed that answer (migration 070: "the entire pass will be cancelled
// and a new pass needs to be raised"), so the guard's second button now closes
// the pass where it stands. `flag_pass` and the `flagged` status are unchanged
// — what changed is that nothing can move the pass afterwards, and the word on
// the button has to say so.
import React, { useState } from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import ModalShell from '../../components/ModalShell';

/** Same ceiling as the approval ladder's rejection modal. */
const MAX_REASON = 500;

interface LineQty {
  item_id: string;
  description: string;
  declared_qty: number;
  verified_qty: number;
}

interface ApprovePanelProps {
  pass: GatePassView;
  items: GatePassItemView[];
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (lines: { item_id: string; verified_qty: number }[], vehicle: string, remarks: string) => void;
}

export function ApprovePanel({ pass, items, submitting, error, onCancel, onConfirm }: ApprovePanelProps): React.ReactElement {
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
    <ModalShell onClose={onCancel} labelledBy="approve-panel-title">
        <h2 id="approve-panel-title" className="modal-title mb-1">Approve Gate Pass</h2>
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
            {submitting ? 'Approving…' : 'Confirm Approval'}
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
  // MANDATORY, and mandatory on the trimmed string: a box of spaces is not a
  // reason. The button is dead until one is typed, so the guard is never told
  // "no" by the server for something the screen could have said first.
  const valid = reason.trim().length > 0;

  return (
    <ModalShell onClose={onCancel} labelledBy="flag-panel-title">
        <h2 id="flag-panel-title" className="modal-title mb-1">Reject Gate Pass</h2>
        <p className="text-sm text-navy-500 mb-5">
          This is final. The pass is cancelled, the material is not released, and the department that
          raised it is notified at once and must raise a new pass. Say why — this is required, and
          your reason is what they will act on.
        </p>

        <div className="mb-1">
          <label className="label" htmlFor="gate-flag-reason">Reason for rejecting *</label>
          <textarea
            id="gate-flag-reason"
            className="input"
            rows={4}
            autoFocus
            maxLength={MAX_REASON}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Only 1 drill of the 2 declared is present."
          />
        </div>
        <p className="text-xs text-navy-500 mb-4 text-right">
          {reason.length}/{MAX_REASON}
        </p>

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
            {submitting ? 'Rejecting…' : 'Reject and Cancel Pass'}
          </button>
        </div>
    </ModalShell>
  );
}
