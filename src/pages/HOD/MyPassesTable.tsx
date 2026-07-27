// The passes table for MyPasses.tsx: loading skeleton, empty state, and the
// populated table with the per-row Void action. Split out to keep MyPasses.tsx
// under the 300-line rule — same "extract sub-components" convention as
// VerifyPanels.tsx / MatchPanel / FlagPanel.
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { STATUS_STYLES, RETURN_STYLES, OVERDUE_STYLE } from '../../lib/statusStyles';
import { formatDateTime } from '../../lib/formatDate';
import Badge, { TypeChip } from '../../components/Badge';

interface MyPassesTableProps {
  /** Unfiltered rows — only used to tell "nothing raised yet" apart from
   *  "filters matched nothing" in the empty state. */
  rows: GatePassView[];
  filtered: GatePassView[];
  loading: boolean;
  onVoidClick: (p: GatePassView, e: React.MouseEvent) => void;
  onDeleteClick: (p: GatePassView, e: React.MouseEvent) => void;
}

function returnBadge(p: GatePassView) {
  if (p.is_overdue) return <Badge style={OVERDUE_STYLE} />;
  return <Badge style={RETURN_STYLES[p.return_status]} />;
}

export default function MyPassesTable({
  rows,
  filtered,
  loading,
  onVoidClick,
  onDeleteClick,
}: MyPassesTableProps): React.ReactElement {
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="table-wrap p-4 flex flex-col gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton h-10 w-full" />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="table-wrap empty-state">
        <p>{rows.length === 0 ? 'You have not raised any gate passes yet.' : 'No passes match these filters.'}</p>
        <Link to="/raise" className="btn-primary inline-block mt-3">
          Raise a Gate Pass
        </Link>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table className="table-base">
        <thead>
          <tr>
            <th>Pass No</th>
            <th>Type</th>
            <th>Visitor</th>
            <th>Material</th>
            <th>Qty</th>
            <th>Status</th>
            <th>Return</th>
            <th>Raised</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((p) => (
            <tr key={p.id} className="cursor-pointer" onClick={() => navigate(`/pass/${p.id}`)}>
              <td className="font-semibold text-navy-900">{p.pass_number}</td>
              <td>
                <TypeChip type={p.type} />
              </td>
              <td>{p.visitor_name}</td>
              <td className="max-w-[220px] truncate">{p.material_description}</td>
              <td className="tabular">
                {p.quantity} {p.unit}
              </td>
              <td>
                <Badge style={STATUS_STYLES[p.status]} />
              </td>
              <td>{returnBadge(p)}</td>
              <td className="tabular whitespace-nowrap">{formatDateTime(p.created_at)}</td>
              <td>
                {/* Only a still-pending pass can be cancelled or deleted —
                    matched, flagged and cancelled are all terminal.
                    Labelled "Cancel", not "Void": the underlying RPC is
                    cancel_pass and the status is 'cancelled', so the button
                    should say the same word the rest of the system uses. */}
                {p.status === 'pending' && (
                  <div className="flex gap-1 justify-end whitespace-nowrap">
                    <button type="button" className="btn-ghost" onClick={(e) => onVoidClick(p, e)}>
                      Cancel
                    </button>
                    <button type="button" className="btn-ghost" onClick={(e) => onDeleteClick(p, e)}>
                      Delete
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
