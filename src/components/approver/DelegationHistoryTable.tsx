// "Delegation History" — every delegation this approver has ever written,
// newest first.
//
// ⚠ IT IS NOT DRAWN UNTIL THE READER ASKS FOR IT (client, 2026-08-22: "make
// sure you don't show the history on the first page but only when the user
// clicks on the top right corner, Delegation History, then only you show them
// below a delegation history table"). The page owns that state, not this
// component — a table cannot know whether the button above it was pressed.
//
// THE MOCK'S "Approval Type" AND "Location / Site" COLUMNS ARE NOT DRAWN,
// struck out by the client with the form fields that fed them. Two columns went
// in their place, and both are facts this app actually has: the OFFICE that was
// delegated, and the approval LIMIT it carried. A register that cannot say what
// a past delegation permitted is a register nobody can audit with.
//
// A REVOKED ROW STILL SHOWS ITS ORIGINAL WINDOW, with the moment it was stopped
// beside the badge. Rewriting `ends_at` to the revocation would erase the fact
// that it was ended EARLY, which is the whole reason a revocation is kept
// rather than deleted.
import React, { useState } from 'react';
import { formatDateTime } from '../../lib/formatDate';
import { formatCurrency } from '../../lib/formatCurrency';
import { APPROVAL_ROLE_TITLES } from '../../lib/approvalLadder';
import {
  canRevoke,
  delegateLabel,
  DELEGATION_STATUS_LABELS,
  DELEGATION_STATUS_PILL,
  type DelegationRow,
} from '../../lib/approvalDelegation';

type Props = {
  rows: DelegationRow[];
  busy: boolean;
  onRevoke: (id: string) => void;
};

export default function DelegationHistoryTable({ rows, busy, onRevoke }: Props): React.ReactElement {
  // TWO PRESSES HERE TOO, and held per row rather than by the page: a confirm
  // bar somewhere else on the screen, away from the row it is about, is how the
  // wrong delegation gets revoked. Revoking cannot be undone (062 refuses a
  // second one) and it empties an office's cover while its holder may be away.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="gb-card gb-panel" id="delegation-history">
      <div className="gb-panel-head">
        <h2 className="gb-panel-title">Delegation History</h2>
      </div>

      {rows.length === 0 ? (
        <div className="gb-empty">You have not delegated your office yet.</div>
      ) : (
        <>
          <div className="gb-scroll">
            <table className="gb-table">
              <thead>
                <tr>
                  <th scope="col">Delegated To</th>
                  <th scope="col">Office</th>
                  <th scope="col">Valid From</th>
                  <th scope="col">Valid To</th>
                  <th scope="col">Approval Limit</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created On</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{delegateLabel(r)}</td>
                    <td>{APPROVAL_ROLE_TITLES[r.role_key]}</td>
                    <td>{formatDateTime(r.starts_at)}</td>
                    <td>{formatDateTime(r.ends_at)}</td>
                    <td>{r.approval_limit == null ? 'No Limit' : formatCurrency(r.approval_limit)}</td>
                    <td>
                      <span className={DELEGATION_STATUS_PILL[r.status]}>
                        {DELEGATION_STATUS_LABELS[r.status]}
                      </span>
                      {r.revoked_at && (
                        <span className="gbd-subline">Revoked {formatDateTime(r.revoked_at)}</span>
                      )}
                    </td>
                    <td>{formatDateTime(r.created_at)}</td>
                    <td>
                      {/* NOTHING TO PRESS ON A FINISHED ROW. The mock draws an
                          eye on every row that opens a detail view; every fact
                          this app holds about a delegation is already in the
                          row, so that control would open a copy of what the
                          reader is looking at. */}
                      {canRevoke(r) ? (
                        <button
                          type="button"
                          className="gbd-revoke gbd-revoke-sm"
                          onClick={() =>
                            confirmId === r.id ? onRevoke(r.id) : setConfirmId(r.id)
                          }
                          disabled={busy}
                        >
                          {confirmId === r.id ? 'Confirm Revoke' : 'Revoke'}
                        </button>
                      ) : (
                        <span className="gbd-subline">NA</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="gb-panel-foot">
            <span className="gbd-subline">
              Showing {rows.length} of {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
