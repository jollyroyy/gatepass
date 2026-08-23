// "My Delegation Status" — the one delegation that is live or about to be, and
// the button that ends it (client mock-up, 2026-08-22).
//
// IT STANDS OVER EXACTLY ONE ROW, and only ever a live or a scheduled one:
// `currentDelegation` decides that, not this component. A card headed "My
// Delegation Status" standing over something expired is a reading somebody acts
// on wrongly — the history behind the Delegation History button is where a
// finished delegation belongs.
//
// THERE IS NO ZERO STATE (client, 2026-08-23: "remove My Delegation Status /
// You have no delegation running … from approver view"). Having no cover is the
// ordinary condition of every one of the four offices, and a card that exists
// only to announce it was the first thing on the page for the readers it had
// nothing to tell. The page simply does not draw this card when
// `currentDelegation` finds nothing, so the form is what an approver lands on.
//
// THE MOCK'S "Scope" COLUMN IS NOT DRAWN. It read "All Gate Pass Types /
// Bangalore Plant", and the client struck both out by name ("no need to give
// any option or field to select the gate … no need to mention the type of
// delegation gate pass"). This app has no gate entity and no site to put there
// in any case. What IS drawn in that slot is the Approval Limit, which is the
// only narrowing a delegation actually carries and is enforced inside
// `approve_pass_level` rather than on screen.
//
// REVOKING TAKES TWO PRESSES. It is not undoable — 062 stamps `revoked_at` and
// refuses a second one — and it silently empties an office's cover while its
// holder may be away, so the confirm is the same shape every irreversible
// control in this app uses.
import React, { useState } from 'react';
import { formatDateTime } from '../../lib/formatDate';
import { formatCurrency } from '../../lib/formatCurrency';
import { APPROVAL_ROLE_TITLES } from '../../lib/approvalLadder';
import {
  canRevoke,
  delegateLabel,
  DELEGATION_STATUS_LABELS,
  DELEGATION_STATUS_NOTES,
  DELEGATION_STATUS_PILL,
  type DelegationRow,
} from '../../lib/approvalDelegation';

type Props = {
  row: DelegationRow;
  busy: boolean;
  onRevoke: (id: string) => void;
};

const PersonGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
    <circle cx="12" cy="8" r="3.5" />
    <path strokeLinecap="round" d="M4.5 20a7.5 7.5 0 0115 0" />
  </svg>
);

export default function DelegationStatusCard({ row, busy, onRevoke }: Props): React.ReactElement {
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="gb-card gb-panel gbd-status">
      <div className="gb-panel-head">
        <h2 className="gb-panel-title">My Delegation Status</h2>
      </div>

      <div className="gbd-status-body">
        <span className="gbd-status-plate">{PersonGlyph}</span>

        <div className="gbd-status-lead">
          <span className={DELEGATION_STATUS_PILL[row.status]}>
            {DELEGATION_STATUS_LABELS[row.status]}
          </span>
          <p className="gbd-status-note">{DELEGATION_STATUS_NOTES[row.status]}</p>
        </div>

        <dl className="gbd-status-facts">
          <div className="gbd-fact">
            <dt>Delegated To</dt>
            <dd>{delegateLabel(row)}</dd>
          </div>
          <div className="gbd-fact">
            <dt>Office</dt>
            <dd>{APPROVAL_ROLE_TITLES[row.role_key]}</dd>
          </div>
          <div className="gbd-fact">
            <dt>Valid From</dt>
            <dd>{formatDateTime(row.starts_at)}</dd>
          </div>
          <div className="gbd-fact">
            <dt>Valid To</dt>
            <dd>{formatDateTime(row.ends_at)}</dd>
          </div>
          <div className="gbd-fact">
            <dt>Approval Limit</dt>
            {/* "No Limit" IS THE COMMON CASE AND IS SAID OUT LOUD. A blank
                cell here would read as a limit nobody could see. */}
            <dd>{row.approval_limit == null ? 'No Limit' : formatCurrency(row.approval_limit)}</dd>
          </div>
          {row.reason && (
            <div className="gbd-fact">
              <dt>Reason</dt>
              <dd>{row.reason}</dd>
            </div>
          )}
        </dl>

        {canRevoke(row) && (
          <div className="gbd-status-action">
            {confirming ? (
              <>
                <span className="gbd-confirm">This cannot be undone.</span>
                <button
                  type="button"
                  className="gb-btn-ghost"
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="gbd-revoke"
                  onClick={() => onRevoke(row.id)}
                  disabled={busy}
                >
                  Confirm Revoke
                </button>
              </>
            ) : (
              <button type="button" className="gbd-revoke" onClick={() => setConfirming(true)}>
                Revoke Delegation
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
