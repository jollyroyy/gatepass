// ACTIVITY LOG — every recorded event across every pass, on one screen.
//
// THE ANSWER TO "HOW DO WE SEE THE LOGS?" is this page, and the point worth
// making to anybody who asks: there is nothing to log into a server for. Every
// event in this system is a database row, and every one of them is readable
// here — who raised a pass and when, what it was worth, which office approved
// it at what moment, what the gate did, and what was written on a rejection.
//
// IT INVENTS NOTHING. The three reads are the same tables the pass record's own
// timeline already merges; this widens them from one pass to all of them.
// `activityLog.ts` decides what an event IS, so the CSV and the screen can
// never disagree about one.
//
// A PASS IS IMMUTABLE ONCE RAISED — there is no edit path anywhere in this app —
// so "who entered this value" is always the raising HOD at the raise timestamp,
// and no amendment history is missing from this page. That is a stronger
// guarantee than most systems give and is worth stating out loud.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActivityLog } from '../../lib/useActivityLog';
import {
  applyActivityFilters,
  DEFAULT_ACTIVITY_FILTERS,
  type ActivityLogEntry,
} from '../../lib/activityLog';
import { formatDateTime } from '../../lib/formatDate';
import { downloadCsv } from '../../lib/exportUtils';
import { csvDateTime, csvText } from '../../lib/csvCells';

/** The same 7 / 30 / 90 the admin dashboard offers, so the two boards mean the
 *  same thing by "the last 30 days". */
const WINDOWS = [7, 30, 90];

const CSV_COLUMNS = [
  { key: 'at', header: 'When', format: (r: ActivityLogEntry) => csvDateTime(r.at) },
  { key: 'passNumber', header: 'Gate Pass', format: (r: ActivityLogEntry) => csvText(r.passNumber) },
  { key: 'event', header: 'Event', format: (r: ActivityLogEntry) => csvText(r.event) },
  { key: 'who', header: 'Who', format: (r: ActivityLogEntry) => csvText(r.who) },
  { key: 'detail', header: 'Details', format: (r: ActivityLogEntry) => csvText(r.detail) },
];

export default function ActivityLogPage(): React.ReactElement {
  const [days, setDays] = useState(30);
  const [filters, setFilters] = useState(DEFAULT_ACTIVITY_FILTERS);
  const { rows, loading, error } = useActivityLog(days);

  const shown = useMemo(() => applyActivityFilters(rows, filters), [rows, filters]);
  const today = new Date();
  const maxDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Activity Log</h1>
          <p className="page-subtitle">
            Everything recorded against every gate pass — who raised it, who approved it, and what
            happened at the gate.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="tab-group" role="group" aria-label="Period">
            {WINDOWS.map((d) => (
              <button
                key={d}
                type="button"
                className={days === d ? 'tab-active' : 'tab'}
                onClick={() => setDays(d)}
              >
                {d} days
              </button>
            ))}
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={shown.length === 0}
            onClick={() => downloadCsv(`activity-log-${maxDay}.csv`, shown, CSV_COLUMNS)}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="card p-4 mb-5 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[16rem]">
          <label className="label" htmlFor="activity-search">
            Search
          </label>
          <input
            id="activity-search"
            className="input"
            placeholder="Pass number, person, or what happened…"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>
        <div>
          <label className="label" htmlFor="activity-day">
            Day
          </label>
          <input
            id="activity-day"
            className="input"
            type="date"
            max={maxDay}
            value={filters.day}
            onChange={(e) => setFilters((f) => ({ ...f, day: e.target.value }))}
          />
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setFilters(DEFAULT_ACTIVITY_FILTERS)}
        >
          Reset
        </button>
      </div>

      {error && <div className="alert-error mb-4">{error}</div>}

      {loading ? (
        <div className="flex flex-col gap-2">
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">
          Nothing was recorded in this window.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table-base" data-testid="activity-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Gate Pass</th>
                <th>Event</th>
                <th>Who</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key}>
                  <td className="whitespace-nowrap">{formatDateTime(r.at)}</td>
                  <td>
                    <Link to={`/pass/${r.passId}`} className="text-accent-600 font-medium">
                      {r.passNumber}
                    </Link>
                  </td>
                  <td>{r.event}</td>
                  {/* An event this system records no name for shows nothing,
                      never "System" — inventing an actor is worse than an empty
                      cell in the one table people read to find out who acted. */}
                  <td>{r.who ?? '—'}</td>
                  <td className="text-navy-500">{r.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-navy-500 mt-3">
        Showing {shown.length} of {rows.length} events in the last {days} days. Events are listed
        against the passes raised in this window.
      </p>
    </div>
  );
}
