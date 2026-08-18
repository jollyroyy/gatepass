// "Overdue by department" — the admin's view of where the late material is.
//
// Client, 2026-08-18: "in the Overdue tab, show a bar chart of which
// department has the department-wise overdue items, in the admin."
//
// ADMIN ONLY, and that is a scope fact rather than a preference: an HOD's page
// holds one department by construction, so the chart would be a single column
// restating the Total overdue tile, and the guard's page is today's shift.
//
// It counts the SCOPED rows the table is built from, so a column and the table
// beside it can never disagree about how many lines are late.
import React from 'react';
import type { OverdueRow } from '../../lib/overdueItems';
import { overdueByDepartment } from '../../lib/overdueItems';
import ColumnChart from '../charts/ColumnChart';
import BoardCard from '../board/BoardCard';

type Props = { rows: OverdueRow[] };

export default function OverdueDeptChart({ rows }: Props): React.ReactElement {
  return (
    <BoardCard
      title="Overdue by department"
      subtitle="Material lines past their expected return date, by the department that raised the pass."
    >
      <ColumnChart
        slices={overdueByDepartment(rows)}
        valueLabel="overdue items"
        empty="Nothing is overdue in any department."
      />
    </BoardCard>
  );
}
