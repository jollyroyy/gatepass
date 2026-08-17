// Scope controls for the Reports page: WHICH passes the report covers, as
// opposed to ReportsToolbar which owns WHEN. They sit in the page header, top
// right, and are applied by ReportsPage before any view sees a row, so an
// admin's choice of department or RGP/NRGP holds on screen and prints the same.
//
// Two controls only, inline — no card of their own. Pass type is a segmented
// toggle because there are exactly three states and a dropdown that hides two
// of them is a click tax; department is a select because it grows with the org.
// Neither carries a caption: the toggle names its own states, and the select is
// labelled for assistive tech via aria-label. Everything else (search, CSV)
// stays on the view that owns it.
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

export default function ReportsFilterBar({
  typeFilter,
  onTypeChange,
  deptFilter,
  onDeptChange,
  deptOptions,
  onClear,
}: Props): React.ReactElement {
  const active = typeFilter !== 'all' || deptFilter !== 'all';

  return (
    <div className="flex flex-wrap items-center justify-end gap-2 no-print">
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

      <select
        id="report-dept"
        aria-label="Department"
        className="input w-auto min-w-[170px] text-sm"
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

      {active && (
        <button type="button" className="btn-secondary text-xs px-4 py-1.5" onClick={onClear}>
          Clear
        </button>
      )}
    </div>
  );
}
