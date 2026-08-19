// The read-only second section (client mock-up narrowed by spec, 2026-08-19,
// migration 046): passes routed to my office but currently waiting on an
// EARLIER one.
//
// AN OFFICE HOLDER WHO SEES NOTHING CANNOT TELL AN EMPTY QUEUE FROM A BROKEN
// SCREEN. "It is with the COO" is the answer to the question they would
// otherwise ring somebody about — so this section is drawn whenever it has
// rows, clearly labelled, and offers no Approve/Reject: pressing either would
// only be refused by `approve_pass_level`'s own slip-order check.
import React from 'react';
import { Link } from 'react-router-dom';
import { formatDateOnly } from '../../lib/formatDate';
import { partyOf, TYPE_PILL } from '../../lib/guardBoard';
import { waitingNote, type WaitingBelowRow } from '../../lib/pendingApprovals';

export default function WaitingBelowSection({ rows }: { rows: WaitingBelowRow[] }): React.ReactElement | null {
  if (rows.length === 0) return null;

  return (
    <section className="gb-card gb-panel mt-4">
      <div className="gb-panel-head">
        <span className="gb-panel-title">Routed to your office, waiting on someone else ({rows.length})</span>
      </div>
      <div className="gb-scroll">
        <table className="gb-table">
          <thead>
            <tr>
              <th>Pass ID</th>
              <th>Pass Type</th>
              <th>Vendor</th>
              <th>Requested On</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pass, heldBy }) => (
              <tr key={pass.id}>
                <td>
                  <Link to={`/pass/${pass.id}`} className={`gb-pill ${TYPE_PILL[pass.type]}`}>
                    {pass.pass_number}
                  </Link>
                </td>
                <td>
                  <span className={`gb-pill ${TYPE_PILL[pass.type]}`}>{pass.type}</span>
                </td>
                <td className="gb-truncate">{partyOf(pass)}</td>
                <td>{formatDateOnly(pass.created_at)}</td>
                <td className="text-navy-500">{waitingNote(heldBy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
