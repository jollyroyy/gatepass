// RGP material that is due back — today's returns and every missed date before
// them, oldest first. Drawn to the client's mock-up (2026-08-19).
//
// EXPECTED BACK CARRIES A BADGE, NOT A COLOUR. "Due Today" and "Overdue" come
// straight from `v_gate_passes.due_state` through `DUE_STATE_STYLES`; the fact
// is in the words, so it survives a screenshot, a mono print and a reader who
// does not separate orange from amber. The mock-up prints a bare date here —
// the badge is kept deliberately, because lateness is the only reason two of
// these rows are on the board at all.
//
// The ACTION goes to the page that can RECORD the return line by line —
// `/overdue` for a missed date, `/returns` for today's — because
// `apply_item_returns` is per line and no card on any board records a return.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import { partyOf, returnActionPath, returnedQtyLabel, TYPE_PILL } from '../../lib/guardBoard';
import { DUE_STATE_STYLES } from '../../lib/statusStyles';

const CheckGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

export default function PendingReturnTable({ rows }: { rows: GatePassView[] }): React.ReactElement {
  return (
    <table className="gb-table">
      <thead>
        <tr>
          <th>Pass No.</th>
          <th>Material</th>
          <th>From (Party)</th>
          <th>Expected Back</th>
          <th>Returned Qty</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id}>
            <td>
              <Link to={`/pass/${p.id}`} className={`gb-pill ${TYPE_PILL[p.type]}`}>
                {p.pass_number}
              </Link>
            </td>
            <td className="gb-truncate" title={p.material_summary ?? undefined}>
              {p.material_summary ?? '—'}
            </td>
            <td className="gb-truncate">{partyOf(p)}</td>
            <td>
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                {formatDateOnly(p.expected_return_date)}
                <span className={`gb-pill ${p.due_state === 'overdue' ? 'gb-pill-orange' : 'gb-pill-grey'}`}>
                  {DUE_STATE_STYLES[p.due_state].label}
                </span>
              </span>
            </td>
            <td>{returnedQtyLabel(p)}</td>
            <td>
              <Link to={returnActionPath(p)} className="gb-action gb-action-blue">
                {CheckGlyph}
                Record Return
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
