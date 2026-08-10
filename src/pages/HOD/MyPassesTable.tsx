// The passes list for MyPasses.tsx: loading skeleton, empty state, and the
// populated rows — each a PassRow (the 2026-08-08 card rule) that opens the
// pass detail. Split out to keep MyPasses.tsx under the 300-line rule — same
// "extract sub-components" convention as VerifyPanels.tsx / MatchPanel /
// FlagPanel.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { RETURN_STYLES, OVERDUE_STYLE } from '../../lib/statusStyles';
import Badge from '../../components/Badge';
import PassRow from '../../components/PassRow';

interface MyPassesTableProps {
  /** Unfiltered rows — only used to tell "nothing raised yet" apart from
   *  "filters matched nothing" in the empty state. */
  rows: GatePassView[];
  filtered: GatePassView[];
  loading: boolean;
}

function returnBadge(p: GatePassView): React.ReactElement {
  const style = p.is_overdue ? OVERDUE_STYLE : RETURN_STYLES[p.return_status];
  return <Badge style={style} />;
}

export default function MyPassesTable({
  rows,
  filtered,
  loading,
}: MyPassesTableProps): React.ReactElement {
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
        {rows.length === 0 && (
          <Link to="/raise" className="btn-primary inline-block mt-3">
            Raise a Gate Pass
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {filtered.map((p) => (
        <PassRow
          key={p.id}
          pass={p}
          to={`/pass/${p.id}`}
          badge={
            <span className="inline-flex items-center gap-2">
              {p.item_count > 0 && (
                <span className="text-xs font-semibold text-navy-600 bg-surface-100 border border-surface-300 px-2.5 py-0.5 rounded-full tabular whitespace-nowrap">
                  {p.item_count} item{p.item_count !== 1 ? 's' : ''}
                </span>
              )}
              {p.type === 'RGP' && p.return_status !== 'not_applicable' && returnBadge(p)}
            </span>
          }
        />
      ))}
    </div>
  );
}