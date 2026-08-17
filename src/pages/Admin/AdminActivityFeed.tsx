// "Recent Activity" — the last few passes to move, newest first.
//
// Deliberately NOT a drill. Every other panel on this board answers "show me
// the N passes behind this number"; this one answers "what just happened", and
// a click on a single line should open that pass, not a filtered list of one.
// Each row is therefore a link straight to the pass, and the panel header links
// to the full register.
//
// It reads the SCOPED rows like everything else, so changing the period changes
// this panel too — a feed that quietly ignored the period filter would be the
// one panel on the page describing a different span of time to its neighbours.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import { passStageStyle } from '../../lib/passStage';
import { relativeAge } from '../../lib/formatDate';
import { parseCompanyInfo } from '../../lib/companyInfo';

const SHOWN = 6;

export default function AdminActivityFeed({ rows, loading }: { rows: GatePassView[]; loading: boolean }): React.ReactElement {
  // `created_at` is an ISO-8601 UTC string, so lexicographic order IS
  // chronological order — no Date allocation per comparison.
  const recent = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, SHOWN);

  return (
    <section className="card p-5 flex flex-col h-full min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="card-title border-0 pb-0">Recent Activity</h2>
        <Link to="/all-passes" className="text-caption font-semibold text-accent-600 hover:underline shrink-0">
          View All
        </Link>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: SHOWN }).map((_, i) => (
            <div key={i} className="skeleton h-11 w-full" />
          ))}
        </div>
      ) : recent.length === 0 ? (
        <div className="empty-state">No activity in this period.</div>
      ) : (
        <ul className="flex flex-col -mx-2">
          {recent.map((p) => {
            const style = passStageStyle(p);
            const vendor = parseCompanyInfo(p.visitor_company).name;
            return (
              <li key={p.id}>
                <Link
                  to={`/pass/${p.id}`}
                  className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-surface-100 transition-colors duration-150 min-w-0"
                >
                  <span className={`h-2 w-2 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="text-body font-semibold text-navy-900 truncate">{p.pass_number}</span>
                    <span className="text-caption text-navy-500 truncate">
                      {style.label}
                      {vendor ? ` · ${vendor}` : ''}
                    </span>
                  </span>
                  <span className="text-caption tabular text-navy-500 shrink-0">{relativeAge(p.created_at)} ago</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
