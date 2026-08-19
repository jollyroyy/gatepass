// What is waiting at the barrier to go out, oldest first. Drawn to the
// client's mock-up (2026-08-19): pill pass numbers and type chips coloured by
// type — RGP blue, NRGP green — over the mock-up's grey title-case headings.
//
// The ACTION is "Verify at Gate", not "Approve OUT" as the mock-up letters it,
// and the difference is deliberate: the screen it opens offers Match, Flag and
// Hold, and a button that names only one of the three teaches a guard the
// wrong model of their own job. `canVerifyAtGate` is the same rule `match_pass`
// enforces — a pass that expired while this board sat open falls back to a link
// that works instead of a button that always fails.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { formatTime } from '../../lib/formatDate';
import { partyOf, TYPE_PILL } from '../../lib/guardBoard';
import { canVerifyAtGate } from '../../lib/phoneSearch';

const ArrowGlyph = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12h15M14 7l5 5-5 5" />
  </svg>
);

export default function PendingOutTable({ rows }: { rows: GatePassView[] }): React.ReactElement {
  return (
    <table className="gb-table">
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
              <Link to={`/pass/${p.id}`} className={`gb-pill ${TYPE_PILL[p.type]}`}>
                {p.pass_number}
              </Link>
            </td>
            <td><span className={`gb-pill ${TYPE_PILL[p.type]}`}>{p.type}</span></td>
            <td className="gb-truncate" title={p.material_summary ?? undefined}>
              {p.material_summary ?? '—'}
            </td>
            <td>{p.total_quantity}</td>
            <td className="gb-truncate">{partyOf(p)}</td>
            <td>{formatTime(p.created_at)}</td>
            <td>
              {canVerifyAtGate(p) ? (
                <Link to={`/verify/${p.id}`} className="gb-action gb-action-orange">
                  {ArrowGlyph}
                  Verify at Gate
                </Link>
              ) : (
                <Link to={`/pass/${p.id}`} className="gb-link">
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
