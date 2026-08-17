// The two decisions an HOD is offered about a pass that cannot proceed.
//
// Shared by both review screens, which is the point: a pass stopped at the gate
// and a pass that expired before it got there are different FACTS with the same
// two answers — raise a corrected one, or close this one for good. The words
// differ; the shape, the ordering and the confirmation must not, or the two
// screens drift into behaving differently under the same fingers.
//
// EXACTLY TWO BUTTONS, deliberately. The flagged pass also has an "approve
// override" path, but it lives on the pass detail page where it always did:
// three buttons under a heading that promises two is how a screen gets misread
// at speed.
//
// THE DESTRUCTIVE ONE SITS BEHIND AN INLINE CONFIRMATION, never `window.confirm`
// — that blocks the page and breaks automation (CLAUDE.md). Its reason box is
// optional here and mandatory nowhere: the RPC writes a sensible default remark,
// and a required field on a decision the HOD has already thought about is a
// reason to click away.
import React, { useState } from 'react';

type Props = {
  /** Already decided — nothing left to offer. */
  settled: boolean;
  settledContent: React.ReactNode;
  /** "Reject Permanently" / "Void It Permanently". */
  voidLabel: string;
  /** The one line above the confirm buttons. Say what becomes true, not "are
   *  you sure" — the reader is looking at the pass. */
  voidWarning: string;
  /** Under the two buttons: what "Raise It Again" will actually do. */
  help: string;
  busy: boolean;
  onRaise: () => void;
  onVoid: (reason: string | null) => void;
};

export default function PassDecisionPanel({
  settled, settledContent, voidLabel, voidWarning, help, busy, onRaise, onVoid,
}: Props): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  if (settled) return <div className="empty-state">{settledContent}</div>;

  if (confirming) {
    return (
      <div className="card border border-flagged-500/30 p-5 flex flex-col gap-3">
        <p className="text-sm font-semibold text-flagged-700">{voidWarning}</p>
        <div className="flex flex-col gap-1">
          <label htmlFor="void-reason" className="text-xs font-bold text-navy-500 uppercase tracking-wider">
            Reason (optional)
          </label>
          <textarea
            id="void-reason"
            className="input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-danger"
            onClick={() => onVoid(reason.trim() || null)}
            disabled={busy}
          >
            {busy ? 'Working…' : `Confirm — ${voidLabel}`}
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-primary px-6" onClick={onRaise}>
          Raise It Again
        </button>
        <button type="button" className="btn-danger px-6" onClick={() => setConfirming(true)}>
          {voidLabel}
        </button>
      </div>
      <p className="text-caption text-navy-500">{help}</p>
    </div>
  );
}
