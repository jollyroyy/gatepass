// The passes list for MyPasses.tsx: loading skeleton, empty state, and the
// populated rows — each one `MyPassCard`, the client's own list mock-up
// (2026-08-20), opening the pass record.
//
// It used to render `PassStack` (the guard's six-fact plate). That card is
// unchanged and every OTHER stacked list in the app still draws it; this one
// screen was redrawn to a mock-up of its own. Split out to keep MyPasses.tsx
// under the 300-line rule — the same "extract sub-components" convention as
// VerifyPanels.tsx.
//
// ONE CARD IS OPEN AT A TIME. The disclosure state lives here rather than
// inside each card so opening a second closes the first — a page of unfolded
// item tables is a page nobody can find their place in, and each open card
// costs one `v_gate_pass_items` read.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import MyPassCard from '../../components/mypasses/MyPassCard';

interface MyPassesTableProps {
  /** Unfiltered rows — only used to tell "nothing raised yet" apart from
   *  "filters matched nothing" in the empty state. */
  rows: GatePassView[];
  filtered: GatePassView[];
  loading: boolean;
  /** Admin only: an HOD's register is one department already. */
  showDepartment: boolean;
}

export default function MyPassesTable({
  rows,
  filtered,
  loading,
  showDepartment,
}: MyPassesTableProps): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="mp-list" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="mp-skeleton" />
        ))}
      </div>
    );
  }

  if (filtered.length === 0) {
    return (
      <div className="gb-empty mp-empty">
        <p>{rows.length === 0 ? 'You have not raised any gate passes yet.' : 'No passes match these filters.'}</p>
        {rows.length === 0 && (
          <Link to="/raise" className="gb-btn-primary mp-empty-cta">
            Raise a Gate Pass
          </Link>
        )}
      </div>
    );
  }

  return (
    <ul className="mp-list">
      {filtered.map((p) => (
        <MyPassCard
          key={p.id}
          pass={p}
          showDepartment={showDepartment}
          open={openId === p.id}
          onToggle={() => setOpenId((id) => (id === p.id ? null : p.id))}
        />
      ))}
    </ul>
  );
}
