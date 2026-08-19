// The passes list for MyPasses.tsx: loading skeleton, empty state, and the
// populated rows — each one the guard's stacked pass card, opening the pass
// record (client, 2026-08-19: every stacked list in the app draws the same
// card). `MyPassCard` and its glass shell are deleted with that change. Split out to keep MyPasses.tsx under the 300-line rule — same
// "extract sub-components" convention as VerifyPanels.tsx / MatchPanel /
// FlagPanel.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import PassStack from '../../components/PassStack';

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

  // The HOD raised every one of these, so their own name is not a fact worth a
  // column of the card.
  return <PassStack passes={filtered} showRaisedBy={false} />;
}
