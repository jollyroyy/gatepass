// RGP material that is due back — today's returns and every missed date before
// them, oldest first. Drawn to the client's mock-up (2026-08-19), and since
// that day a page of its own rather than a preview panel on the dashboard.
//
// ONE ROW OPEN AT A TIME. Each open row holds a draft of unrecorded returns and
// a live item query; two of them open at once means two sets of unsaved figures
// on a screen where only one truck is being unloaded. Closing a row discards
// its draft, which is why the row owns that state and this table only says
// which one is open.
//
// EXPECTED BACK CARRIES ITS DUE NOTE IN WORDS. "(Due Today)" under the date,
// and the Status pill beside it, come from `due_state` — graded by the database
// in `site_tz()`, never recomputed here — so the fact survives a screenshot, a
// mono print and a reader who does not separate orange from red. There is no
// "(2 Days Overdue)" here any more: a late pass has left this queue for Overdue
// Returns (client, 2026-08-23).
import React, { useState } from 'react';
import type { GatePassView } from '../../types';
import PendingReturnRow from './PendingReturnRow';

type Props = {
  rows: GatePassView[];
  /** Re-read the queues once a return reaches the database. */
  onRecorded: () => void;
};

export default function PendingReturnTable({ rows, onRecorded }: Props): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <table className="gb-table">
      <thead>
        <tr>
          <th><span className="sr-only">Show items</span></th>
          <th>Pass No.</th>
          <th>Vendor</th>
          <th>Items</th>
          <th>Expected Back</th>
          <th>Status</th>
          <th>Returned Summary</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <PendingReturnRow
            key={p.id}
            pass={p}
            open={openId === p.id}
            onToggle={() => setOpenId((id) => (id === p.id ? null : p.id))}
            onRecorded={onRecorded}
          />
        ))}
      </tbody>
    </table>
  );
}
