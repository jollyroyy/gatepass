// The approver queue's three controls — search, pass type, department — lifted
// out of `PendingApprovals` when a fourth KPI joined that board (067) and the
// page reached its 300-line ceiling.
//
// IT NARROWS EVERY FIGURE AT ONCE, which is why it is one bar above the cards
// rather than a control inside the open stack: each figure on that board is the
// length of its OWN filtered array, so a filter that reached only the stack
// would leave a narrowed list standing under an unnarrowed number — the exact
// disagreement the board invariant exists to prevent.
//
// The department options are built from the rows themselves (`departmentOptions`),
// so an option that would return nothing is never offered.
import React from 'react';
import type { PendingApprovalFilters } from '../../lib/pendingApprovals';

const SearchGlyph = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path strokeLinecap="round" d="M20 20l-3.5-3.5" />
  </svg>
);

type Props = {
  filters: PendingApprovalFilters;
  departments: string[];
  onChange: (next: PendingApprovalFilters) => void;
};

export default function ApprovalFilterBar({
  filters, departments, onChange,
}: Props): React.ReactElement {
  return (
    <div className="gb-filters">
      <div className="gb-search">
        {SearchGlyph}
        <input
          type="text"
          aria-label="Search by Pass ID / Vendor / Purpose"
          placeholder="Search by Pass ID / Vendor / Purpose..."
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>
      <select
        className="gb-select"
        aria-label="Pass Type"
        value={filters.type}
        onChange={(e) => onChange({ ...filters, type: e.target.value as PendingApprovalFilters['type'] })}
      >
        <option value="">Type: All</option>
        <option value="RGP">RGP</option>
        <option value="NRGP">NRGP</option>
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
    </div>
  );
}
