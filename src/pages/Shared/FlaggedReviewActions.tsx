// THE REQUESTER'S ANSWER TO A GATE FLAG, shown only to the HOD who raised the
// pass (the caller enforces who sees it; `hod_review_flagged_pass` enforces it
// again server-side, which is the boundary that counts).
//
// Two answers, and BOTH ARE WRITTEN DOWN (client, 2026-08-23: when the
// requester is content with the guard's flag "he can put it as a proof"). The
// note is mandatory either way and it is what the record shows: migration 065
// writes it into the `verifications` row, so the pass rail names who answered,
// when, and in their own words. Before 065 the clearing answer — the one that
// sends material back out through a barrier a guard had stopped — was the only
// decision in this app with no stated reason on it.
//
// SEND BACK TO THE GATE returns the pass to the guard who flagged it and to
// nobody else: the three approval offices signed it before it ever reached the
// barrier, and this loop does not reopen their rungs.
//
// UPHOLD THE FLAG is final — the pass becomes `cancelled` and can never be
// verified at the gate — so it sits behind an inline confirmation rather than
// firing on one click. Never window.confirm: it blocks the page and breaks
// automation (CLAUDE.md).
import React, { useState } from 'react';
import { gp } from '../../supabaseClient';
import { safeErrorMessage } from '../../lib/errors';

/** Same ceiling as every other written decision in this app. */
const MAX_REASON = 500;

interface FlaggedReviewActionsProps {
  passId: string;
  onDone: () => void;
  onError: (message: string) => void;
}

function NoteField({
  id, label, value, onChange, busy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  busy: boolean;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-bold text-navy-500 uppercase tracking-wider">
        {label}
      </label>
      <textarea
        id={id}
        className="input"
        rows={3}
        maxLength={MAX_REASON}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={busy}
      />
    </div>
  );
}

export default function FlaggedReviewActions({
  passId,
  onDone,
  onError,
}: FlaggedReviewActionsProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  // Which answer the HOD is writing. Neither can be sent blind: the note comes
  // first, and the button that commits it is dead until one is typed.
  const [answering, setAnswering] = useState<'none' | 'clear' | 'uphold'>('none');
  const [reason, setReason] = useState('');

  // MANDATORY on the trimmed string — a box of spaces is not an answer.
  const valid = reason.trim().length > 0;

  async function send(action: 'approve' | 'reject') {
    setBusy(true);
    try {
      const { error: rpcErr } = await gp().rpc('hod_review_flagged_pass', {
        p_pass_id: passId,
        p_action: action,
        p_reason: reason.trim(),
      });
      if (rpcErr) throw rpcErr;
      onDone();
    } catch (err) {
      onError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    setAnswering('none');
    setReason('');
  }

  if (answering === 'clear') {
    return (
      <div className="flex flex-col gap-3 mt-1 border border-matched-500/30 rounded-xl p-4 bg-matched-500/5">
        <p className="text-sm font-semibold text-matched-700">
          The pass goes straight back to the gate that flagged it. It does not return to the approvers.
        </p>
        <NoteField
          id="clear-flag-note"
          label="Why you are clearing this flag *"
          value={reason}
          onChange={setReason}
          busy={busy}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => send('approve')} disabled={busy || !valid}>
            {busy ? 'Sending…' : 'Send Back to the Gate'}
          </button>
          <button type="button" className="btn-ghost" onClick={cancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (answering === 'uphold') {
    return (
      <div className="flex flex-col gap-3 mt-1 border border-flagged-500/30 rounded-xl p-4 bg-flagged-500/5">
        <p className="text-sm font-semibold text-flagged-700">
          This is final. The pass will be closed and the material will not be released.
        </p>
        <NoteField
          id="uphold-flag-note"
          label="Why you are upholding this flag *"
          value={reason}
          onChange={setReason}
          busy={busy}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-danger" onClick={() => send('reject')} disabled={busy || !valid}>
            {busy ? 'Closing…' : 'Uphold the Flag'}
          </button>
          <button type="button" className="btn-ghost" onClick={cancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" className="btn-primary" onClick={() => setAnswering('clear')} disabled={busy}>
        Send Back to the Gate
      </button>
      <button type="button" className="btn-danger" onClick={() => setAnswering('uphold')} disabled={busy}>
        Uphold the Flag
      </button>
    </div>
  );
}
