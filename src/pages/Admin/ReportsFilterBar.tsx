// The report's scope card, drawn to the client's mock-up (2026-08-20): Date
// Range, Pass Type, Status, Created By — and Reset.
//
// EVERY CONTROL APPLIES ITSELF (client, 2026-08-21: "remove the apply filters
// from everywhere. As soon as anything is changed in those filters it should
// automatically get reflected"). It used to hold a DRAFT copy that only an
// Apply Filters button moved onto the report — the mock drew that button — and
// the cost was a card that could sit there describing a scope the table below it
// was not using. There is one `ReportFilters` now, and changing a control IS the
// change. Reset returns to the opening 30-day range.
//
// THE READY-MADE RANGES sit under the two date inputs, inside the same Date
// Range field (client, 2026-08-20: "in all the reports across admin and HOD,
// under the date selection, mention Last 7 days / ... / Last 1 year"). Because
// BOTH the admin's `/all-passes` and the HOD's `/reports` render this one
// component, "all the reports" is satisfied by one control — see
// `src/lib/reportsDateRange.ts` for the windows themselves.
//
// Department is a FIFTH select the mock does not draw. It is here because the
// register now carries a "Raised By Department" column (client, 2026-08-20) and
// because filtering a printed report to one department is a standing feature —
// it takes the same control shape as the four beside it, so the card still reads
// as the mock's one row.
import React from 'react';
import {
  presetOf,
  presetRange,
  RANGE_PRESETS,
  type RangePreset,
} from '../../lib/reportsDateRange';
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
  /** The live filters. There is no draft copy — see the header. */
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  createdByOptions?: ReportOption[];
  deptOptions?: ReportOption[];
  today: string;
  onReset: () => void;
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
  filters,
  onChange,
  createdByOptions = [],
  deptOptions = [],
  today,
  onReset,
  showPeople = true,
}: Props): React.ReactElement {
  const set = (patch: Partial<ReportFilters>) => onChange({ ...filters, ...patch });

  return (
    <section className="gb-card gb-rep-filters no-print">
      <div className="gb-rep-field">
        <span className="gb-rep-field-label" id="report-range-label">Date Range</span>
        <div className="gb-rep-dates">
          <input
            type="date"
            aria-label="From date"
            value={filters.from}
            max={filters.to || today}
            onChange={(e) => set({ from: e.target.value })}
          />
          <span className="gb-rep-dash" aria-hidden="true">–</span>
          <input
            type="date"
            aria-label="To date"
            value={filters.to}
            min={filters.from}
            max={today}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
        {/* THE READY-MADE RANGES, under the date selection (client, 2026-08-20).
            It writes the two inputs above rather than holding a window of its
            own: there is still ONE date range on this report, and the select
            only says which one. Its value is DERIVED from those inputs
            (`presetOf`), so moving an edge by hand drops it back to "Custom
            range" instead of leaving it claiming a window that is no longer on
            screen. Every preset ends TODAY, not on the draft's own `to` date —
            "Last 7 days" means the last seven days. */}
        <select
          className="gb-select gb-rep-preset"
          aria-label="Quick range"
          value={presetOf(filters.from, filters.to, today)}
          onChange={(e) => {
            const key = e.target.value as RangePreset;
            if (key === 'custom') return;
            set(presetRange(key, today));
          }}
        >
          <option value="custom">Custom range</option>
          {RANGE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </div>

      <label className="gb-rep-field">
        <span className="gb-rep-field-label">Pass Type</span>
        <select
          className="gb-select"
          aria-label="Pass Type"
          value={filters.type}
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
          value={filters.status}
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
            value={filters.createdBy}
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
            value={filters.department}
            onChange={(e) => set({ department: e.target.value })}
          >
            <option value="">All departments</option>
            {deptOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </label>
      )}

      {/* RESET IS THE ONLY BUTTON LEFT. It is disabled while nothing is
          narrowed, so it never offers to undo something that has not been done;
          the date range is deliberately not counted as "narrowed" (a report
          always covers some range), which is `isNarrowed`'s own rule. */}
      <div className="gb-rep-filter-actions">
        <button
          type="button"
          className="gb-btn-ghost"
          onClick={onReset}
          disabled={!isNarrowed(filters)}
        >
          {FUNNEL}
          Reset
        </button>
      </div>
    </section>
  );
}
