// The list a clicked dashboard KPI reveals — the same rows the card counted,
// so the number and the list can never disagree. Shared by the HOD and admin
// dashboards; a drill is a list, not a register.
//
// Renovated 2026-08-11 (client): these were flat single-line rows, and the
// client preferred the gate console's card view of that era. Each row is now
// a DrillPassCard — a shadcn Card (CardHeader of identity + status,
// CardContent of facts via PassRowBody, CardFooter of actions) — at compact
// density. `onOpen` survives as the card's own click-through. (The guard's
// own board moved off pass cards entirely on 2026-08-19, replaced by two
// tables — Pending OUT and Pending RGP Return — so this card idiom is now
// specific to the HOD/admin drills.)
import React from 'react';
import type { GatePassView } from '../types';
import DrillPassCard from './DrillPassCard';
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
        <div className="flex flex-col gap-2 w-full">
          {rows.map((p, i) => (
            <DrillPassCard key={p.id} pass={p} index={i + 1} showRaisedBy={showRaisedBy} />
          ))}
        </div>
      )}
    </div>
  );
}