// "Pending Approvals" — the passes standing at the gate right now.
//
// TWO THINGS THE CLIENT'S REFERENCE BOARD HAS THAT THIS ONE DELIBERATELY DOES
// NOT, and they are the same thing twice: an approve tick and a reject cross in
// every row.
//
// An admin cannot approve or reject a gate pass in this system, and that is not
// an omission — it is the security model. Every state transition goes through a
// SECURITY DEFINER RPC (`match_pass`, `flag_pass`), no client holds UPDATE on
// `gatepass.gate_passes` at all, and `match_pass` refuses anyone who is not the
// verifying guard ("Only security can verify a gate pass."). A tick here would
// be a button that always fails, on the screen of the person least able to
// understand why. The row opens the pass instead; the decision belongs at the
// barrier, to the guard standing at it.
//
// The count in the header is the FULL pending count, while the table shows the
// first few — so the header states the obligation honestly and "View All" is
// the way to the rest, rather than the table quietly implying there are five.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { categoryFor } from '../../lib/passTypes';
import { formatDateTime } from '../../lib/formatDate';

const SHOWN = 5;

type Props = {
  rows: GatePassView[];
  loading: boolean;
  /** Opens the same rows this table is drawn from, as the shared drill list. */
  onDrill: () => void;
  active: boolean;
};

export default function AdminPendingTable({ rows, loading, onDrill, active }: Props): React.ReactElement {
  const shown = rows.slice(0, SHOWN);

  return (
    <section className="card p-5 flex flex-col min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 className="card-title border-0 pb-0">Pending Approvals</h2>
          <span className="text-caption tabular text-navy-500 shrink-0">{loading ? '—' : rows.length}</span>
        </div>
        <button
          type="button"
          onClick={onDrill}
          aria-pressed={active}
          className="text-caption font-semibold text-accent-600 hover:underline shrink-0"
        >
          Show all as cards
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: SHOWN }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">Queue clear — nothing is waiting at the gate.</div>
      ) : (
        // The table scrolls inside its own card. The page body must never
        // scroll sideways because one panel has eight columns.
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="table-base min-w-[640px]">
            <thead>
              <tr>
                <th>Pass No.</th>
                <th>Category</th>
                <th>Vendor</th>
                <th>Material</th>
                <th className="text-right">Qty</th>
                <th>Department</th>
                <th>Raised On</th>
                <th className="text-right">Details</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id}>
                  <td className="font-semibold text-navy-900 whitespace-nowrap">{p.pass_number}</td>
                  <td className="whitespace-nowrap">
                    <span className="type-chip">{categoryFor(p.type, p.direction).label}</span>
                  </td>
                  <td className="max-w-[9rem] truncate">{parseCompanyInfo(p.visitor_company).name || '—'}</td>
                  <td className="max-w-[11rem] truncate">{p.material_summary || '—'}</td>
                  <td className="text-right tabular">{p.total_quantity}</td>
                  <td className="max-w-[8rem] truncate">{p.department_name || '—'}</td>
                  <td className="whitespace-nowrap text-navy-500">{formatDateTime(p.created_at)}</td>
                  <td className="text-right whitespace-nowrap">
                    <Link to={`/pass/${p.id}`} className="text-accent-600 font-semibold hover:underline">
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && rows.length > SHOWN && (
        <p className="text-caption text-navy-500 mt-3">
          Showing {SHOWN} of {rows.length}.{' '}
          <Link to="/all-passes" className="link-inline text-accent-600 hover:underline">
            Open the full register
          </Link>
          .
        </p>
      )}
    </section>
  );
}
