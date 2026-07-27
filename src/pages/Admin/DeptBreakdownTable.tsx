// Small presentational table for AllPasses.tsx — split out purely to keep
// AllPasses.tsx under the file's line budget.
import React from 'react';

export interface DeptBreakdown {
  id: string;
  name: string;
  pending: number;
  matched: number;
  flagged: number;
}

type Props = { rows: DeptBreakdown[] };

export default function DeptBreakdownTable({ rows }: Props): React.ReactElement {
  return (
    <div className="mb-8">
      <h2 className="section-title mb-3">By Department</h2>
      <div className="table-wrap">
        <table className="table-base">
          <thead>
            <tr>
              <th>Department</th>
              <th>Pending</th>
              <th>Matched</th>
              <th>Flagged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id}>
                <td className="font-semibold text-navy-900">{d.name}</td>
                <td className="tabular">{d.pending}</td>
                <td className="tabular">{d.matched}</td>
                <td className="tabular">{d.flagged}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
