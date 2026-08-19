// What is waiting at the barrier to go out, oldest first.
//
// The ACTION is "Verify at Gate", not "Approve OUT" as the client's mock-up
// drew it, and the difference is deliberate: the screen it opens offers Match,
// Flag and Hold, and a button that names only one of the three teaches a guard
// the wrong model of their own job. `canVerifyAtGate` is the same rule
// `match_pass` enforces — a pass that expired while this board sat open falls
// back to a link that works instead of a button that always fails.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { TypeChip } from '../Badge';
import { formatTime } from '../../lib/formatDate';
import { partyOf } from '../../lib/guardBoard';
import { canVerifyAtGate } from '../../lib/phoneSearch';

export default function PendingOutTable({ rows }: { rows: GatePassView[] }): React.ReactElement {
  return (
    <table className="table-base">
      <thead>
        <tr>
          <th>Pass No.</th>
          <th>Type</th>
          <th>Material</th>
          <th>Qty</th>
          <th>Party</th>
          <th>Time</th>
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
            <td><TypeChip type={p.type} /></td>
            <td className="max-w-[16rem] truncate" title={p.material_summary ?? undefined}>
              {p.material_summary ?? '—'}
            </td>
            <td>{p.total_quantity}</td>
            <td className="max-w-[12rem] truncate">{partyOf(p)}</td>
            <td>{formatTime(p.created_at)}</td>
            <td>
              {canVerifyAtGate(p) ? (
                <Link to={`/verify/${p.id}`} className="btn-secondary whitespace-nowrap">
                  Verify at Gate
                </Link>
              ) : (
                <Link to={`/pass/${p.id}`} className="text-xs font-semibold text-accent-600 hover:underline">
                  View pass
                </Link>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
