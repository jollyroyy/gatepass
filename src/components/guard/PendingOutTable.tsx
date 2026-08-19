// The Pending OUT queue as its own table (client mock-up, 2026-08-19) — it was
// a five-row preview panel on the guard's dashboard until the two lists moved
// onto pages of their own and the dashboard's cards became the way in.
//
// ONE ROW OPEN AT A TIME. A guard reads one pass, decides, and presses Approve
// OUT; leaving four detail panels open behind them means four item queries
// still in flight and a table that has to be scrolled past to reach the next
// truck.
import React, { useState } from 'react';
import type { GatePassView } from '../../types';
import PendingOutRow from './PendingOutRow';

export default function PendingOutTable({ rows }: { rows: GatePassView[] }): React.ReactElement {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <table className="gb-table">
      <thead>
        <tr>
          <th><span className="sr-only">Show items</span></th>
          <th>Pass No.</th>
          <th>Type</th>
          <th>Party</th>
          <th>Items</th>
          <th>Total Qty</th>
          <th>Vehicle No.</th>
          <th>Department</th>
          <th>Requested By</th>
          <th>Requested Time</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <PendingOutRow
            key={p.id}
            pass={p}
            open={openId === p.id}
            onToggle={() => setOpenId((id) => (id === p.id ? null : p.id))}
          />
        ))}
      </tbody>
    </table>
  );
}
