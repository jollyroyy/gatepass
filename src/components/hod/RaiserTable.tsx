// EVERYONE THIS HOD HAS AUTHORISED TO RAISE, newest first (migration 077).
//
// The approvers' Delegation History behind a button is the shape this follows,
// with one deliberate difference: it is drawn straight away rather than hidden
// until asked for. An approver's history is a record of absences already over;
// this table is the ANSWER to "who can raise passes in my name right now", which
// is the question that brought the HOD to the page.
//
// A REVOKED ROW STILL SHOWS ITS ORIGINAL WINDOW, with the moment it was stopped
// beside the badge. Rewriting `ends_at` to the revocation would erase the fact
// that it was ended EARLY, which is the whole reason a revocation is kept rather
// than deleted — and the passes raised under it keep the HOD rung they carry.
import React, { useState } from 'react';
import { formatDateTime } from '../../lib/formatDate';
import {
  DELEGATION_STATUS_LABELS,
  DELEGATION_STATUS_PILL,
} from '../../lib/approvalDelegation';
import { canRevokeRaiser, raiserLabel, type PassRaiserRow } from '../../lib/passRaising';

type Props = {
  rows: PassRaiserRow[];
  busy: boolean;
  onRevoke: (id: string) => void;
};

export default function RaiserTable({ rows, busy, onRevoke }: Props): React.ReactElement {
  // TWO PRESSES, held per row rather than by the page: a confirm bar somewhere
  // else on the screen, away from the row it is about, is how the wrong person
  // gets stood down. Revoking cannot be undone.
  const [confirmId, setConfirmId] = useState<string | null>(null);

  return (
    <div className="gb-card gb-panel" id="pass-raisers">
      <div className="gb-panel-head">
        <h2 className="gb-panel-title">People You Have Authorised</h2>
      </div>

      {rows.length === 0 ? (
        <div className="gb-empty">
          You have not authorised anybody yet. You raise every pass for your department yourself.
        </div>
      ) : (
        <>
          <div className="gb-scroll">
            <table className="gb-table">
              <thead>
                <tr>
                  <th scope="col">Authorised</th>
                  <th scope="col">Valid From</th>
                  <th scope="col">Valid To</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created On</th>
                  <th scope="col" className="sticky-action">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{raiserLabel(r)}</td>
                    <td>{formatDateTime(r.starts_at)}</td>
                    <td>{formatDateTime(r.ends_at)}</td>
                    {/* An empty cell, never an em-dash: the CSV rule, and the
                        same reading on screen. */}
                    <td>{r.reason ?? ''}</td>
                    <td>
                      <span className={DELEGATION_STATUS_PILL[r.status]}>
                        {DELEGATION_STATUS_LABELS[r.status]}
                      </span>
                      {r.revoked_at && (
                        <span className="gbd-subline">Revoked {formatDateTime(r.revoked_at)}</span>
                      )}
                    </td>
                    <td>{formatDateTime(r.created_at)}</td>
                    <td className="sticky-action">
                      {canRevokeRaiser(r) ? (
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
