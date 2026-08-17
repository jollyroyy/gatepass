// "Overdue Returns" — returnable material that is past its date and still out.
//
// THE ONE PANEL ON THIS BOARD THAT IS NOT PERIOD-SCOPED, and the exception is
// deliberate. Everything else answers "what happened in the selected window";
// an overdue return is an OPEN OBLIGATION, and it does not stop being open
// because the calendar rolled past the window it started in. An RGP raised
// three weeks ago whose ladders never came back is more urgent today than one
// raised this morning, not less — scoping it would hide exactly the passes this
// panel exists to surface. The header says "all time" out loud rather than
// leaving it to look like an inconsistency nobody noticed.
//
// (The guard board makes the same exception for the same reason — see the module
// comment in src/lib/guardDrills.ts.)
//
// `is_overdue` and `expected_return_date` both come straight off
// `v_gate_passes`. The days-late figure below is presentation of a fact the
// database already decided; it never DECIDES lateness, because the view owns
// that comparison in the site's timezone and a screen that re-derives it will
// disagree with the database for every pass raised after 18:30 IST.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';

const SHOWN = 5;

type Props = {
  rows: GatePassView[];
  loading: boolean;
  onDrill: () => void;
  active: boolean;
};

export default function BoardOverdueList({ rows, loading, onDrill, active }: Props): React.ReactElement {
  const shown = rows.slice(0, SHOWN);

  return (
    <section className="card p-5 flex flex-col h-full min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="card-title border-0 pb-0 text-flagged-700">Overdue Returns</h2>
        <button
          type="button"
          onClick={onDrill}
          aria-pressed={active}
          className="text-caption font-semibold text-accent-600 hover:underline shrink-0"
        >
          View All
        </button>
      </div>
      <p className="text-caption text-navy-500 mb-3">All time — an open obligation outlives the period filter.</p>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-14 w-full" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="empty-state">Nothing is overdue.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((p) => (
            <li key={p.id}>
              <Link
                to={`/pass/${p.id}`}
                className="flex items-start justify-between gap-3 pl-3 py-2 rounded-r-xl border-l-4 border-l-overdue-500 hover:bg-surface-100 transition-colors duration-150 min-w-0"
              >
                <span className="flex flex-col min-w-0">
                  <span className="text-body font-semibold text-flagged-700 truncate">{p.pass_number}</span>
                  <span className="text-caption text-navy-700 truncate">{p.material_summary || '—'}</span>
                  <span className="text-caption text-navy-500 truncate">
                    Expected: {formatDateOnly(p.expected_return_date)}
                  </span>
                </span>
                <span className="text-caption font-semibold tabular text-overdue-700 shrink-0 text-right">
                  {daysLate(p.expected_return_date)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {!loading && rows.length > SHOWN && (
        <p className="text-caption text-navy-500 mt-3">
          {rows.length - SHOWN} more overdue.
        </p>
      )}
    </section>
  );
}

/** How late, in whole days, for display only — the pass is already known to be
 *  overdue (`is_overdue`, from the view). Returns a bare "Overdue" rather than a
 *  count when the pass carries no expected date at all, which a legacy row can:
 *  "0 Days Overdue" would read as "due today", the opposite of the truth. */
function daysLate(expected: string | null): string {
  if (!expected) return 'Overdue';
  const days = Math.floor((Date.now() - new Date(expected).getTime()) / (24 * 60 * 60 * 1000));
  if (days < 1) return 'Overdue';
  return `${days} ${days === 1 ? 'Day' : 'Days'} Overdue`;
}
