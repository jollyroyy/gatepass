// "Passes by department" — who raises the most, as columns.
//
// Client, 2026-08-18: "make a vertical bar chart showing the departments who
// are raising the most number of passes under the admin dashboard."
//
// ADMIN ONLY: an HOD's board is one department by construction, so the same
// chart there would be a single column restating the RGP Raised tile.
//
// IT IS NOT A DRILL. Every other figure on the board carries the rows it
// counted and opens them; this panel sits in the board's footer, outside the
// drill machinery, so it states a ranking and offers no click that would open
// a list the board cannot render. Reports (`/all-passes`) is where those rows
// are read one by one.
import React, { useMemo } from 'react';
import type { GatePassView } from '../../types';
import { departmentSlices } from '../../lib/boardAnalytics';
import { dayStart, DAY_MS } from '../../lib/localDay';
import ColumnChart from '../charts/ColumnChart';
import BoardCard from './BoardCard';

/** Past about eight columns the labels stop being readable at any width, and
 *  the tail of a long ranking is noise — the question is who is on top. */
const TOP = 8;

type Props = { rows: GatePassView[]; loading: boolean };

export default function BoardDepartments({ rows, loading }: Props): React.ReactElement {
  // TODAY ONLY (client, 2026-08-18). Scoped on `created_at` in LOCAL time, the
  // same cut `GateBoard` makes for its `raised` window — the ranking answers
  // "who is raising passes today", not "who has ever raised the most", which no
  // longer moves once a year's history is in the array.
  const today = useMemo(() => {
    const start = dayStart(Date.now());
    const end = start + DAY_MS;
    return rows.filter((p) => {
      if (!p.created_at) return false;
      const t = new Date(p.created_at).getTime();
      return t >= start && t < end;
    });
  }, [rows]);

  return (
    <BoardCard
      title="Passes by department"
      subtitle={`Which departments raised the most gate passes today — top ${TOP}.`}
      loading={loading}
      skeletonHeight="h-56"
    >
      <ColumnChart
        slices={departmentSlices(today, TOP)}
        valueLabel="passes"
        empty="No pass has been raised today."
      />
    </BoardCard>
  );
}
