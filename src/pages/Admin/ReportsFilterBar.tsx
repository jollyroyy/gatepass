// Scope bar for the Reports page: WHICH passes the report covers, as opposed
// to ReportsToolbar which owns WHEN. Both filters sit above the portal tabs and
// are applied by ReportsPage before any view sees a row, so an admin's choice of
// department or RGP/NRGP survives switching between All Passes, Return Schedule
// and Department Summary — and prints the same way from each.
//
// Two controls only. Pass type is a segmented control because there are exactly
// three states and a dropdown that hides two of them is a click tax; department
// is a select because it grows with the org. Everything else (search, CSV) stays
// on the view that owns it.
import React from 'react';
import type { PassType } from '../../types';
import { PASS_TYPE_LIST, PASS_TYPES } from '../../lib/passTypes';

export type TypeFilter = PassType | 'all';

export type DeptOption = { id: string; name: string };

type Props = {
  typeFilter: TypeFilter;
  onTypeChange: (t: TypeFilter) => void;
  deptFilter: string;
  onDeptChange: (id: string) => void;
  deptOptions: DeptOption[];
  onClear: () => void;
};

const TYPE_SEGMENTS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  ...PASS_TYPE_LIST.map((t) => ({ key: t as TypeFilter, label: PASS_TYPES[t].code })),
];

/** Full names for the active-scope caption — a printed report should not make
 *  the reader expand "NRGP" from memory. Direct lookup, never string matching. */
const TYPE_CAPTION: Record<TypeFilter, string> = {
  all: 'All pass types',
  RGP: PASS_TYPES.RGP.label,
  NRGP: PASS_TYPES.NRGP.label,
};

export default function ReportsFilterBar({
  typeFilter,
  onTypeChange,
  deptFilter,
  onDeptChange,
  deptOptions,
  onClear,
}: Props): React.ReactElement {
  const active = typeFilter !== 'all' || deptFilter !== 'all';
  const deptName = deptOptions.find((d) => d.id === deptFilter)?.name;

  return (
    <div className="card px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-4 no-print">
      <div className="flex items-center gap-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-navy-400">
          Pass Type
        </span>
        <div className="tab-group" role="group" aria-label="Pass type">
          {TYPE_SEGMENTS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              aria-pressed={key === typeFilter}
              onClick={() => onTypeChange(key)}
              className={key === typeFilter ? 'tab-active text-xs px-4 py-1.5' : 'tab-inactive text-xs px-4 py-1.5'}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden md:block h-8 w-px bg-surface-200" aria-hidden="true" />

      <div className="flex items-center gap-3">
        <label
          htmlFor="report-dept"
          className="text-[11px] font-semibold uppercase tracking-widest text-navy-400"
        >
          Department
        </label>
        <select
          id="report-dept"
          className="input w-auto min-w-[190px] text-sm"
          value={deptFilter}
          onChange={(e) => onDeptChange(e.target.value)}
        >
          <option value="all">All departments</option>
          {deptOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      {active && (
        <div className="flex items-center gap-3 ml-auto">
          <span className="text-xs text-navy-500">
            {deptName ?? 'All departments'} · {TYPE_CAPTION[typeFilter]}
          </span>
          <button type="button" className="btn-secondary text-xs px-4 py-1.5" onClick={onClear}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
