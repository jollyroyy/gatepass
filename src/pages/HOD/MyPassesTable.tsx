// The passes list for MyPasses.tsx: loading skeleton, empty state, and the
// populated rows — each a PassRow (the 2026-08-08 card rule) that opens the
// pass detail. Split out to keep MyPasses.tsx under the 300-line rule — same
// "extract sub-components" convention as VerifyPanels.tsx / MatchPanel /
// FlagPanel.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import MyPassCard from './MyPassCard';

interface MyPassesTableProps {
  /** Unfiltered rows — only used to tell "nothing raised yet" apart from
   *  "filters matched nothing" in the empty state. */
  rows: GatePassView[];
  filtered: GatePassView[];
  loading: boolean;
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
    <div className="flex flex-col gap-2">
      {filtered.map((p, i) => (
        <MyPassCard
          key={p.id}
          pass={p}
          index={i + 1}
          badge={
            p.item_count > 1 ? (
              <>
                <span className="w-1 h-1 rounded-full bg-navy-300 shrink-0" />
                <span className="text-navy-600 shrink-0 tabular-nums">{p.item_count} items</span>
              </>
            ) : null
          }
        />
      ))}
    </div>
  );
}