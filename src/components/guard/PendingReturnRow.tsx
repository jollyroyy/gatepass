// One row of the Pending RGP Return page, and the panel it opens (client
// mock-up, 2026-08-19).
//
// THE ROW IS A SUMMARY; THE PANEL IS WHERE THE WORK HAPPENS. A chevron opens
// the pass's own material lines beside a block of vehicle, purpose and
// authorisation — everything a guard needs to check a returning load against
// what left — without leaving the queue and losing their place in it.
//
// TWO PRESSES, AND ONLY THE SECOND ONE IS REAL. Each line's "+ Add Return"
// stages a quantity and a remark in `draft`, held here, in memory; the Record
// bar at the foot of the panel is what calls `apply_item_returns`, ONCE, with
// every staged line. That shape is forced by the database: a recorded return
// cannot be undone (`returned_qty` only ever increases), so a tap must not be
// the commit. Cancel, or closing the row, throws the draft away and nothing
// happened.
//
// AFTER THE RPC THE LIST IS RE-READ, never patched. The pass closes itself
// server-side once the last line comes back, and only the database knows
// whether this movement was the last one — `onRecorded` re-reads both queues.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import { partyOf, TYPE_PILL } from '../../lib/guardBoard';
import { itemsLabel } from '../../lib/pendingOutFilters';
import { recordDraftedReturns } from '../../lib/recordReturns';
import {
  draftPayload,
  draftRemarks,
  EMPTY_DRAFT,
  effectiveOutstanding,
  effectiveReturned,
  dueNote,
  passReturnState,
  PASS_RETURN_LABELS,
  PASS_RETURN_PILL,
  returnSummary,
  stagedCount,
  stageLine,
  type DraftLine,
  type ReturnDraft,
} from '../../lib/returnDraft';
import { safeErrorMessage } from '../../lib/errors';
import { usePassItems } from '../../lib/usePassItems';
import AddReturnBox from './AddReturnBox';
import PendingReturnItems from './PendingReturnItems';
import ReturnRowMeta from './ReturnRowMeta';

/** Every cell in the row, chevron included, so the detail row spans the whole
 *  table rather than leaving a ragged edge. */
export const PENDING_RETURN_COLUMNS = 8;

const Chevron = ({ open }: { open: boolean }): React.ReactElement => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ transform: open ? 'rotate(180deg)' : undefined }}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const VerifyGlyph = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

type Props = {
  pass: GatePassView;
  open: boolean;
  onToggle: () => void;
  /** Re-read the queues after a return reaches the database. */
  onRecorded: () => void;
};

export default function PendingReturnRow({
  pass,
  open,
  onToggle,
  onRecorded,
}: Props): React.ReactElement {
  // Loaded only while the row is open — the id goes null on close, which is
  // what throws the lines away along with the draft below.
  const { items, error } = usePassItems(open ? pass.id : null);
  const [draft, setDraft] = useState<ReturnDraft>(EMPTY_DRAFT);
  const [editing, setEditing] = useState<GatePassItemView | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const staged = stagedCount(draft);
  const summary = returnSummary(pass);
  const state = passReturnState(pass);
  const note = dueNote(pass);

  function close(): void {
    setDraft(EMPTY_DRAFT);
    setEditing(null);
    setSaveError(null);
    onToggle();
  }

  async function record(): Promise<void> {
    if (!items || staged === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await recordDraftedReturns(pass.id, draftPayload(items, draft), draftRemarks(items, draft));
      setDraft(EMPTY_DRAFT);
      setEditing(null);
      onRecorded();
    } catch (err) {
      setSaveError(safeErrorMessage(err, 'Could not record this return.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr>
        <td>
          <button
            type="button"
            className="gb-expand"
            onClick={open ? close : onToggle}
            aria-expanded={open}
            aria-label={open ? `Hide items in ${pass.pass_number}` : `Show items in ${pass.pass_number}`}
          >
            <Chevron open={open} />
          </button>
        </td>
        <td>
          <Link to={`/pass/${pass.id}`} className={`gb-pill ${TYPE_PILL[pass.type]}`}>
            {pass.pass_number}
          </Link>
        </td>
        <td className="gb-truncate">{partyOf(pass)}</td>
        <td>
          <button type="button" className="gb-link" onClick={open ? close : onToggle}>
            {itemsLabel(pass.item_count)}
          </button>
        </td>
        <td>
          {formatDateOnly(pass.expected_return_date)}
          {/* Every row here is due TODAY — a late pass has left for Overdue
              Returns — so the note is never the red lateness line. */}
          {note && <span className="gb-subline">{note}</span>}
        </td>
        <td>
          <span className={`gb-pill ${PASS_RETURN_PILL[state]}`}>{PASS_RETURN_LABELS[state]}</span>
        </td>
        <td>
          {summary.text}
          <span className="gb-subline">({summary.percent}%)</span>
        </td>
        <td>
          {/* No overflow menu beside it (client, 2026-08-19). The pass number
            * in this same row is already a link to the full record, so the
            * three-dot control was a second door onto one destination. */}
          {/* Opens the pass's own record (client, 2026-08-19), where the
            * approval ladder, the facts and the same line-by-line return entry
            * all sit together. The chevron beside the pass number still opens
            * the panel below without leaving the queue, so a guard clearing a
            * row of trucks keeps their place. */}
          <Link to={`/pass/${pass.id}`} className="gb-action gb-action-blue">
            {VerifyGlyph}
            Verify Return
          </Link>
        </td>
      </tr>

      {open && (
        <tr>
          <td className="gb-detail-cell" colSpan={PENDING_RETURN_COLUMNS}>
            <div className="gb-detail">
              <div className="gb-detail-box">
                <div className="gb-detail-title">Items in this Pass ({pass.item_count})</div>
                {error ? (
                  <div className="gb-empty">{error}</div>
                ) : items === undefined ? (
                  <div className="gb-empty">
                    <div className="gb-skeleton" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="gb-empty">This pass lists no material lines.</div>
                ) : (
                  <>
                    <div className="gb-scroll">
                      <PendingReturnItems
                        items={items}
                        draft={draft}
                        onAdd={saving ? null : setEditing}
                      />
                    </div>
                    {saveError && <div className="gb-alert">{saveError}</div>}
                    {staged > 0 && (
                      <div className="gb-commit">
                        <span className="gb-commit-text">
                          {staged} {staged === 1 ? 'line is' : 'lines are'} staged and not yet
                          recorded. Recording cannot be undone.
                        </span>
                        <span className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            className="gb-btn-ghost"
                            onClick={() => setDraft(EMPTY_DRAFT)}
                            disabled={saving}
                          >
                            Discard
                          </button>
                          <button
                            type="button"
                            className="gb-btn-primary"
                            onClick={() => void record()}
                            disabled={saving}
                          >
                            {saving ? 'Recording…' : `Record ${staged} ${staged === 1 ? 'Return' : 'Returns'}`}
                          </button>
                        </span>
                      </div>
                    )}
                  </>
                )}
              </div>

              <ReturnRowMeta pass={pass} />
            </div>
          </td>
        </tr>
      )}

      {open && editing && (
        <ReturnBoxPortal
          item={editing}
          draft={draft}
          onCancel={() => setEditing(null)}
          onConfirm={(line) => {
            setDraft((d) => stageLine(d, editing.id, line));
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

/** The box is rendered from a table row, so it must not be a table cell: it is
 *  `position: fixed` and belongs to the viewport, not to the row. React lets it
 *  sit here in the tree; CSS takes it out of the table's flow. */
function ReturnBoxPortal({
  item,
  draft,
  onConfirm,
  onCancel,
}: {
  item: GatePassItemView;
  draft: ReturnDraft;
  onConfirm: (line: DraftLine) => void;
  onCancel: () => void;
}): React.ReactElement {
  return (
    <tr>
      <td className="gb-detail-cell" colSpan={PENDING_RETURN_COLUMNS}>
        <AddReturnBox
          item={item}
          alreadyReturned={effectiveReturned(item, draft) - (draft[item.id]?.qty ?? 0)}
          outstanding={effectiveOutstanding(item, draft) + (draft[item.id]?.qty ?? 0)}
          existing={draft[item.id]}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      </td>
    </tr>
  );
}
