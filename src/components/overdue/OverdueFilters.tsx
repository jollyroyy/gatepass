// The filter bar of Overdue Items: department, delay band, and a Clear that
// only appears when something is actually narrowing the list.
//
// THE REFERENCE BAR'S THIRD CONTROL IS "All categories". This database has no
// category on a material line — `gate_pass_items` carries name, description,
// purpose, quantity, unit and value — so the control would filter nothing. It is
// left out rather than rendered dead: the same rule that put QUANTITY in the
// mock-up's CONDITION column on the Scheduled Returns table.
//
// The department select is built FROM THE ROWS, so it can never offer a
// department that filters the table to empty.
import React from 'react';
import {
  DELAY_FILTER_LABELS, hasActiveFilters, type DelayFilter, type OverdueFilterState,
} from '../../lib/overdueItems';

type Props = {
  value: OverdueFilterState;
  departments: { id: string; name: string }[];
  onChange: (next: OverdueFilterState) => void;
  onClear: () => void;
};

const SELECT =
  'text-sm font-medium bg-transparent border border-surface-200 rounded-xl px-3 py-2 pr-8 ' +
  'text-navy-700 cursor-pointer focus:ring-2 focus:ring-brand-500/40 appearance-none';

const CHEVRON = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 0.65rem center',
} as const;

export default function OverdueFilters({ value, departments, onChange, onClear }: Props): React.ReactElement {
  return (
    <div className="card p-3 mb-4 flex flex-wrap items-center gap-3">
      <select
        aria-label="Department"
        className={SELECT}
        style={CHEVRON}
        value={value.department}
        onChange={(e) => onChange({ ...value, department: e.target.value })}
      >
        <option value="all">All departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Delay"
        className={SELECT}
        style={CHEVRON}
        value={value.delay}
        onChange={(e) => onChange({ ...value, delay: e.target.value as DelayFilter })}
      >
        {(Object.keys(DELAY_FILTER_LABELS) as DelayFilter[]).map((k) => (
          <option key={k} value={k}>
            {DELAY_FILTER_LABELS[k]}
          </option>
        ))}
      </select>

      {hasActiveFilters(value) && (
        <button type="button" className="text-sm font-medium text-accent-600 hover:underline" onClick={onClear}>
          Clear filters
        </button>
      )}
    </div>
  );
}
