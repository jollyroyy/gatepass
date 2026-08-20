// The mock's "Filters" button and what it opens (2026-08-20).
//
// NOTHING WAS REMOVED TO GET HERE. The page used to wear its period presets,
// its calendar, its status tabs, its Awaiting Return toggle and Export CSV
// across two rows of chrome above the list; the mock draws one button. So the
// controls moved rather than being dropped — a filter that is one click away is
// still a filter, and an HOD who narrowed to "Mismatched" last week can still
// do it.
//
// THE SCOPE CONTROLS SIT ON TOP, NOT IN HERE (client, 2026-08-20: "same drop
// down, like the selection date on top and all the drop downs, like last 30
// days, last three months, six months"). The period is `PeriodSelect` below,
// rendered in the page header beside the calendar; what is left behind the
// Filters button is the state narrowing — status, Awaiting Return — and the
// export.
//
// The panel is a plain disclosure, not a popover: it pushes the list down
// instead of floating over it, so a narrowed scope stays visible while it is
// being read and there is no outside-click to trap. `aria-expanded` is on the
// button, which is what a screen reader and the tests both key on.
import React from 'react';
import type { PassStatus } from '../../types';
import { MY_PASSES_PERIODS, type MyPassesPeriod } from '../../lib/myPassesPeriod';

export interface StatusTab {
  key: PassStatus | 'all';
  label: string;
}

type Props = {
  open: boolean;
  statusTabs: StatusTab[];
  status: PassStatus | 'all';
  onStatus: (s: PassStatus | 'all') => void;
  awaitingReturn: boolean;
  onAwaitingReturn: () => void;
  onExport: () => void;
};

/** The period, as the one dropdown the client asked for. A `<select>` rather
 *  than the seven chips this page used to wear: seven buttons is a row of
 *  chrome above a list that is meant to be the page. */
export function PeriodSelect({
  value,
  onChange,
}: {
  value: MyPassesPeriod;
  onChange: (p: MyPassesPeriod) => void;
}): React.ReactElement {
  return (
    <select
      className="gb-select"
      aria-label="Period"
      value={value}
      onChange={(e) => onChange(e.target.value as MyPassesPeriod)}
    >
      {MY_PASSES_PERIODS.map(({ key, label }) => (
        <option key={key} value={key}>
          {label}
        </option>
      ))}
    </select>
  );
}

export function FiltersButton({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button type="button" className="mp-filters-btn" aria-expanded={open} onClick={onToggle}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3.75 5.25h16.5l-6.5 7.5v5.5l-3.5 2v-7.5z" />
      </svg>
      Filters
      <svg className="mp-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M6 9l6 6 6-6" />
      </svg>
    </button>
  );
}

export default function MyPassesFilters(props: Props): React.ReactElement | null {
  if (!props.open) return null;
  const { statusTabs, status, onStatus } = props;
  return (
    <section className="mp-filters" aria-label="Filters">
      <label className="mp-filter-field">
        <span className="gb-rep-field-label">Status</span>
        <select
          className="gb-select"
          aria-label="Status"
          value={status}
          onChange={(e) => onStatus(e.target.value as PassStatus | 'all')}
        >
          {statusTabs.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
      </label>

      <div className="mp-filter-field">
        <span className="gb-rep-field-label">Return</span>
        <button
          type="button"
          className="mp-chip"
          aria-pressed={props.awaitingReturn}
          onClick={props.onAwaitingReturn}
        >
          Awaiting Return
        </button>
      </div>

      <div className="mp-filter-field mp-filter-actions">
        <button type="button" className="gb-reset" onClick={props.onExport}>
          Export CSV
        </button>
      </div>
    </section>
  );
}
