// The report's scope card, drawn to the client's mock-up (2026-08-20): Date
// Range, Pass Type, Status, Created By, then Reset and Apply Filters.
//
// A DRAFT AND AN APPLIED SET, because the mock draws an Apply Filters button and
// a button that applies what is already applied is a lie. The page holds two
// copies of `ReportFilters`; every control here writes the DRAFT, and only Apply
// (or Reset) moves it onto the report. That also stops a 250-row table
// re-rendering under the reader's hand while they set four controls.
//
// Department is a FIFTH select the mock does not draw. It is here because the
// register now carries a "Raised By Department" column (client, 2026-08-20) and
// because filtering a printed report to one department is a standing feature —
// it takes the same control shape as the four beside it, so the card still reads
// as the mock's one row.
import React from 'react';
import {
  isNarrowed,
  STATUS_FILTERS,
  TYPE_FILTERS,
  type ReportFilters,
  type ReportOption,
  type StatusFilter,
  type TypeFilter,
} from '../../lib/gatePassReport';

const FUNNEL = (
  <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.9} aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.25h15l-5.75 6.75v6l-3.5 1.75v-7.75z" />
  </svg>
);

type Props = {
  draft: ReportFilters;
  onDraftChange: (next: ReportFilters) => void;
  createdByOptions?: ReportOption[];
  deptOptions?: ReportOption[];
  today: string;
  onApply: () => void;
  onReset: () => void;
  /** True while the draft differs from what the report is actually showing. */
  dirty: boolean;
  /** False on the HOD's own Reports tab (2026-08-20, client: "remove the
   *  Department and Raised By columns for an individual HOD, both from the
   *  column header and from the filter section"). Both selects answer a
   *  question RLS has already answered for an HOD — their rows are their own
   *  department's — so there is nothing left for either control to narrow.
   *  Defaults true so the admin's card, which this component still is, is
   *  unchanged by the new prop. */
  showPeople?: boolean;
};

export default function ReportsFilterBar({
  draft,
  onDraftChange,
  createdByOptions = [],
  deptOptions = [],
  today,
  onApply,
  onReset,
  dirty,
  showPeople = true,
}: Props): React.ReactElement {
  const set = (patch: Partial<ReportFilters>) => onDraftChange({ ...draft, ...patch });

  return (
    <section className="gb-card gb-rep-filters no-print">
      <div className="gb-rep-field">
        <span className="gb-rep-field-label" id="report-range-label">Date Range</span>
        <div className="gb-rep-dates">
          <input
            type="date"
            aria-label="From date"
            value={draft.from}
            max={draft.to || today}
            onChange={(e) => set({ from: e.target.value })}
          />
          <span className="gb-rep-dash" aria-hidden="true">–</span>
          <input
            type="date"
            aria-label="To date"
            value={draft.to}
            min={draft.from}
            max={today}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
      </div>

      <label className="gb-rep-field">
        <span className="gb-rep-field-label">Pass Type</span>
        <select
          className="gb-select"
          aria-label="Pass Type"
          value={draft.type}
          onChange={(e) => set({ type: e.target.value as TypeFilter })}
        >
          {TYPE_FILTERS.map((t) => (
            <option key={t.key} value={t.key}>{t.label}</option>
          ))}
        </select>
      </label>

      <label className="gb-rep-field">
        <span className="gb-rep-field-label">Status</span>
        <select
          className="gb-select"
          aria-label="Status"
          value={draft.status}
          onChange={(e) => set({ status: e.target.value as StatusFilter })}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </label>

      {showPeople && (
        <label className="gb-rep-field">
          <span className="gb-rep-field-label">Created By</span>
          <select
            className="gb-select"
            aria-label="Created By"
            value={draft.createdBy}
            onChange={(e) => set({ createdBy: e.target.value })}
          >
            <option value="">All Users</option>
            {createdByOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
      )}

      {showPeople && (
        <label className="gb-rep-field">
          <span className="gb-rep-field-label">Department</span>
          <select
            className="gb-select"
            aria-label="Department"
            value={draft.department}
            onChange={(e) => set({ department: e.target.value })}
          >
            <option value="">All departments</option>
            {deptOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
      )}

      <div className="gb-rep-filter-actions">
        <button
          type="button"
          className="gb-btn-ghost"
          onClick={onReset}
          disabled={!isNarrowed(draft) && !dirty}
        >
          Reset
        </button>
        <button type="button" className="gb-btn-primary" onClick={onApply} disabled={!dirty}>
          {FUNNEL}
          Apply Filters
        </button>
      </div>
    </section>
  );
}
