// The list a clicked dashboard KPI reveals — same rows the card counted,
// rendered as PassRows (the 2026-08-08 card rule) so it slots under the KPI
// grid without a page nav. Shared by the HOD and admin dashboards; a drill is
// a list, not a register.
import React from 'react';
import type { GatePassView } from '../types';
import PassRow from './PassRow';
import type { DrillDef } from '../lib/hodDrills';

const SKELETON_ROWS = 6;

type Props = {
  def: DrillDef<string>;
  rows: GatePassView[];
  loading: boolean;
  onOpen: (id: string) => void;
};

export default function DrillList({ def, rows, loading, onOpen }: Props): React.ReactElement {
  return (
    <div className="mb-8">
      <div className="flex items-baseline gap-3 mb-3">
        <h2 className="section-title mb-0">{def.heading}</h2>
        <span className="text-xs font-medium text-navy-400 tabular">
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
        <div className="flex flex-col gap-3">
          {rows.map((p) => (
            <PassRow key={p.id} pass={p} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  );
}