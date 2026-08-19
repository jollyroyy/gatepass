// The list a clicked dashboard KPI reveals — the same rows the card counted,
// so the number and the list can never disagree. Shared by the HOD and admin
// dashboards; a drill is a list, not a register.
//
// Rebuilt 2026-08-19 (client): "all the cards across all the admin, whether
// admin or HOD level, should mimic the exact same stacked card style of the
// guard's view … upon clicking on those cards it should show up the exact
// details as guard." So a drill row is now `PassStackCard` — the guard's own
// plate — and it LINKS to `/pass/:id` instead of expanding in place. The
// shadcn drill card (`DrillPassCard`, `PassRow variant="drill"`, `PassRowBody`)
// is deleted, so a stale reference is a build error rather than a second card
// style nobody notices.
import React from 'react';
import type { GatePassView } from '../types';
import PassStack from './PassStack';
import type { DrillDef } from '../lib/boardDrills';

const SKELETON_ROWS = 6;

type Props = {
  def: DrillDef<string>;
  rows: GatePassView[];
  loading: boolean;
  /** Defaults to true (the admin board, which oversees every department). The
   *  HOD dashboard passes false — they raised these passes themselves. */
  showRaisedBy?: boolean;
};

export default function DrillList({
  def,
  rows,
  loading,
  showRaisedBy = true,
}: Props): React.ReactElement {
  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="section-title mb-0">{def.heading}</h2>
        <span className="text-xs font-medium text-navy-500 tabular">
          {rows.length} {rows.length === 1 ? 'pass' : 'passes'}
        </span>
      </div>

      {loading ? (
        <div className="table-wrap p-4 flex flex-col gap-2">
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="table-wrap empty-state">{def.empty}</div>
      ) : (
        <PassStack passes={rows} showRaisedBy={showRaisedBy} />
      )}
    </div>
  );
}