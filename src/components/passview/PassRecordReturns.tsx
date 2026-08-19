// The material table PLUS the machinery that records a return on it.
//
// Client, 2026-08-19: the record a guard opens from Approve OUT or Verify
// Return IS where the return is entered — the mock-up puts the editable
// quantity on this very table. So the line-by-line draft that lived only on the
// guard's return queue lives here too, over the same `returnDraft.ts` and the
// same `apply_item_returns` call. Two screens, one rule set; nothing about a
// return is decided twice.
//
// TWO PRESSES, AND ONLY THE SECOND IS REAL. "+ Add Return" opens the box and
// "Confirm Return" STAGES the line in memory; the "Record N returns" bar under
// the table is the commit, one RPC for the whole set. That shape is forced by
// the database — a recorded return cannot be undone — and it is why a staged
// line stays tinted and says "Not recorded yet" even when its quantity closes
// it out.
//
// ONCE A PASS IS RETURNED, NOTHING ON IT CAN BE EDITED (client). `canRecord` is
// `canRecordReturns`, which is false for every role but the guard and false for
// any pass whose `return_status` has left awaiting/partially returned — the
// same two conditions `apply_item_returns` raises on. The closed strip says so
// out loud rather than leaving a table with no controls and no explanation.
//
// AFTER THE RPC THE RECORD IS RE-READ, NEVER PATCHED. Only the database knows
// whether that movement was the last line and closed the pass.
import React, { useState } from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import {
  draftPayload, draftRemarks, effectiveOutstanding, effectiveReturned,
  stageLine, stagedCount, unstageLine, EMPTY_DRAFT, type ReturnDraft,
} from '../../lib/returnDraft';
import { recordDraftedReturns } from '../../lib/recordReturns';
import { isReturnClosed } from '../../lib/approvalLadder';
import { pendingItemCount } from '../../lib/passRecordView';
import { safeErrorMessage } from '../../lib/errors';
import PassRecordItems from './PassRecordItems';
import PassReturnBox from './PassReturnBox';

type Props = {
  pass: GatePassView;
  items: GatePassItemView[];
  /** True only for a guard, on a pass that still owes material. */
  canRecord: boolean;
  /** Re-read the whole record — the pass may have just closed itself. */
  onRecorded: () => void;
};

export default function PassRecordReturns({
  pass, items, canRecord, onRecorded,
}: Props): React.ReactElement {
  const [draft, setDraft] = useState<ReturnDraft>(EMPTY_DRAFT);
  const [open, setOpen] = useState<GatePassItemView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staged = stagedCount(draft);
  // Counted on the draft-inclusive quantities, so staging the last line drops
  // the strip immediately — the guard is looking at what the press will do.
  const stillOpen = pendingItemCount(
    items.map((i) => ({ ...i, returned_qty: effectiveReturned(i, draft) })),
    pass.type,
  );
  const firstOpen = items.find((i) => effectiveOutstanding(i, draft) > 0) ?? null;

  async function commit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await recordDraftedReturns(pass.id, draftPayload(items, draft), draftRemarks(items, draft));
      setDraft(EMPTY_DRAFT);
      setOpen(null);
      onRecorded();
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <PassRecordItems
        pass={pass}
        items={items}
        draft={draft}
        canRecord={canRecord && !busy}
        onAdd={setOpen}
        onDiscard={(itemId) => setDraft((d) => unstageLine(d, itemId))}
      />

      {error && <div className="alert-error">{error}</div>}

      {/* The record is closed for good. Said plainly, because a table with no
          controls and no sentence reads as a screen that failed to load. */}
      {isReturnClosed(pass) && (
        <div className="alert-success" data-testid="return-locked">
          <span className="font-semibold">
            Fully returned and closed — nothing on this pass can be edited.
          </span>
        </div>
      )}

      {/* The mock-up's amber strip. It states the one condition that keeps this
          pass open, and its button goes straight to the first line holding it
          up — drawn only for a guard, because nobody else can record a return
          and a button that always fails is worse than no button. */}
      {stillOpen > 0 && !isReturnClosed(pass) && (
        <div className="alert-warning flex flex-wrap items-center justify-between gap-3" data-testid="items-need-attention">
          <span>
            <span className="font-semibold">{stillOpen}</span>{' '}
            {stillOpen === 1 ? 'item still needs' : 'items still need'} attention before this pass
            can be closed
          </span>
          {canRecord && firstOpen && (
            <button type="button" className="btn-primary" onClick={() => setOpen(firstOpen)}>
              Review pending items
            </button>
          )}
        </div>
      )}

      {staged > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 card px-5 py-3">
          <p className="text-sm text-navy-700">
            <span className="font-semibold">{staged}</span> {staged === 1 ? 'line' : 'lines'} staged —
            not saved yet. A recorded return cannot be undone.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setDraft(EMPTY_DRAFT)}
              disabled={busy}
            >
              Discard
            </button>
            <button
              type="button"
              data-testid="record-pass-returns"
              className="btn-primary"
              onClick={() => void commit()}
              disabled={busy}
            >
              {busy ? 'Recording…' : `Record ${staged} ${staged === 1 ? 'return' : 'returns'}`}
            </button>
          </div>
        </div>
      )}

      {/* Re-opening a STAGED line CORRECTS that figure rather than adding to it,
          so this line's own staged quantity is taken back out of both the
          "already returned" note and the ceiling — otherwise a guard fixing 800
          to 900 would be told only 200 is left. */}
      {open && (
        <PassReturnBox
          item={open}
          alreadyReturned={effectiveReturned(open, draft) - (draft[open.id]?.qty ?? 0)}
          outstanding={effectiveOutstanding(open, draft) + (draft[open.id]?.qty ?? 0)}
          existing={draft[open.id]}
          onConfirm={(line) => {
            setDraft((d) => stageLine(d, open.id, line));
            setOpen(null);
          }}
          onCancel={() => setOpen(null)}
        />
      )}
    </div>
  );
}
