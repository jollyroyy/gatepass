// RGP material that is due back — today's returns and every missed date before
// them, oldest first.
//
// EXPECTED BACK CARRIES A BADGE, NOT A COLOUR. "Due Today" and "Overdue" come
// straight from `v_gate_passes.due_state` through `DUE_STATE_STYLES`; the fact
// is in the words, so it survives a screenshot, a mono print and a reader who
// does not separate orange from amber.
//
// The ACTION goes to the page that can RECORD the return line by line —
// `/overdue` for a missed date, `/returns` for today's — because
// `apply_item_returns` is per line and no card on any board records a return.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import Badge from '../Badge';
import { formatDateOnly } from '../../lib/formatDate';
import { partyOf, returnActionPath, returnedQtyLabel } from '../../lib/guardBoard';
import { DUE_STATE_STYLES } from '../../lib/statusStyles';

export default function PendingReturnTable({ rows }: { rows: GatePassView[] }): React.ReactElement {
  return (
    <table className="table-base">
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
              <Link to={`/pass/${p.id}`} className="font-semibold text-accent-600 hover:underline">
                {p.pass_number}
              </Link>
            </td>
            <td className="max-w-[16rem] truncate" title={p.material_summary ?? undefined}>
              {p.material_summary ?? '—'}
            </td>
            <td className="max-w-[12rem] truncate">{partyOf(p)}</td>
            <td>
              <span className="flex items-center gap-2 whitespace-nowrap">
                {formatDateOnly(p.expected_return_date)}
                <Badge style={DUE_STATE_STYLES[p.due_state]} />
              </span>
            </td>
            <td>{returnedQtyLabel(p)}</td>
            <td>
              <Link to={returnActionPath(p)} className="btn-secondary whitespace-nowrap">
                Record Return
              </Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
