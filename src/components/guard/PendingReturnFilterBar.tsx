// The Pending RGP Return page's scope controls: Vendor, Department, Status,
// Sort by, and a Reset that is disabled until there is something to reset
// (client mock-up, 2026-08-19).
//
// The Status select and the tab strip above it are ONE choice with two
// controls, exactly as the mock draws it — both write `filters.tab`, so they
// can never show two different answers.
//
// The Vendor and Department options come from `scopeOptions(rows)`, built from
// the loaded rows themselves: an option that would return an empty table is
// never offered in the first place. There is no Type control — only an RGP
// comes back, so a filter with one live value teaches nothing.
import React from 'react';
import type { PendingReturnFilters, ReturnSortKey, ReturnTab } from '../../lib/pendingReturnFilters';
import {
  isReturnFiltered,
  RETURN_SORT_LABELS,
  RETURN_TABS,
  RETURN_TAB_LABELS,
} from '../../lib/pendingReturnFilters';

const ResetGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.25 4.5v3.25H7.5" />
  </svg>
);

type Props = {
  filters: PendingReturnFilters;
  parties: string[];
  departments: string[];
  onChange: (next: PendingReturnFilters) => void;
  onReset: () => void;
};

export default function PendingReturnFilterBar({
  filters,
  parties,
  departments,
  onChange,
  onReset,
}: Props): React.ReactElement {
  return (
    <div className="gb-filters">
      <select
        className="gb-select"
        aria-label="Vendor"
        value={filters.party}
        onChange={(e) => onChange({ ...filters, party: e.target.value })}
      >
        <option value="">Vendor: All</option>
        {parties.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <select
        className="gb-select"
        aria-label="Department"
        value={filters.department}
        onChange={(e) => onChange({ ...filters, department: e.target.value })}
      >
        <option value="">Department: All</option>
        {departments.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>

      <select
        className="gb-select"
        aria-label="Status"
        value={filters.tab}
        onChange={(e) => onChange({ ...filters, tab: e.target.value as ReturnTab })}
      >
        {RETURN_TABS.map((t) => (
          <option key={t} value={t}>
            Status: {RETURN_TAB_LABELS[t]}
          </option>
        ))}
      </select>

      <select
        className="gb-select"
        aria-label="Sort by"
        value={filters.sort}
        onChange={(e) => onChange({ ...filters, sort: e.target.value as ReturnSortKey })}
      >
        {(Object.keys(RETURN_SORT_LABELS) as ReturnSortKey[]).map((k) => (
          <option key={k} value={k}>
            Sort by: {RETURN_SORT_LABELS[k]}
          </option>
        ))}
      </select>

      <button
        type="button"
        className="gb-reset"
        onClick={onReset}
        disabled={!isReturnFiltered(filters)}
      >
        {ResetGlyph}
        Reset
      </button>
    </div>
  );
}
