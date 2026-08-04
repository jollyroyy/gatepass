// Per-department summary table, used by the Admin Dashboard (all-time) and the
// Department Summary report (date-ranged). `computeDeptBreakdown` owns the
// counting so both consumers stay identical; the component is pure display.
import React from 'react';
import type { GatePassView } from '../../types';

export interface DeptBreakdown {
  id: string;
  name: string;
  pending: number;
  matched: number;
  flagged: number;
}

export function computeDeptBreakdown(rows: GatePassView[]): DeptBreakdown[] {
  const map = new Map<string, DeptBreakdown>();
  for (const p of rows) {
    const entry = map.get(p.department_id) ?? {
      id: p.department_id,
      name: p.department_name,
      pending: 0,
      matched: 0,
      flagged: 0,
    };
    if (p.status === 'pending') entry.pending += 1;
    else if (p.status === 'matched') entry.matched += 1;
    else if (p.status === 'flagged') entry.flagged += 1;
    map.set(p.department_id, entry);
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
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
              <th>Pending for Gate Approval</th>
              <th>Matched</th>
              <th>Mismatched</th>
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
