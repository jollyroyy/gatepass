// "RGP Return Watch" — the four buckets of still-out material as a tabbed
// register: Overdue, Due Today, Due in Next 7 Days, Due After 7 Days.
//
// THE TABS ARE THE SAME FOUR BUCKETS AS THE DONUT BESIDE IT, from the same
// `returnWatchBuckets` call shape, so a reader who reads 2 off the ring and clicks
// the Overdue tab sees exactly those two passes.
//
// ALL FOUR TABS ALWAYS EXIST, even at zero. A tab that disappears when it empties
// reads as "this system has no such state", which is a stronger and wronger claim
// than "none right now" — and it moves the other tabs under the reader's finger.
//
// ONLY THE TOP FEW ROWS ARE LISTED (the client's "keep only the top items"): the
// header count is the honest total and "View All" opens the whole bucket as the
// shared drill list, rather than the table quietly implying there are five.
//
// The table scrolls inside its own card. The page body must never scroll sideways
// because one panel has eight columns.
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { GatePassView } from '../../types';
import {
  returnWatchBuckets,
  returnWatchKeyOf,
  daysOverdue,
  RETURN_WATCH_LABEL,
  RETURN_WATCH_PILL,
  type ReturnWatchKey,
} from '../../lib/returnWatch';
import type { BoardDrill } from '../../lib/boardDrills';
import { parseCompanyInfo } from '../../lib/companyInfo';
import { formatDateOnly } from '../../lib/formatDate';
import { RETURN_WATCH_COLORS } from '../charts/chartPalette';

const SHOWN = 5;

/** Tinted pill, dark ink — the same idiom as every other status badge in the app.
 *  A `Record`, so a fifth bucket without a pill style is a type error. */
const PILL: Record<ReturnWatchKey, string> = {
  overdue: 'bg-flagged-50 text-flagged-700',
  dueToday: 'bg-overdue-50 text-overdue-700',
  dueIn7: 'bg-pending-50 text-pending-700',
  dueLater: 'bg-accent-50 text-accent-600',
};

type Props = {
  /** Every pass the reader may see, unscoped by period — an obligation outlives
   *  the window it was raised in. */
  rows: GatePassView[];
  loading: boolean;
  activeKey: string | null;
  onSelect: (drill: BoardDrill) => void;
  /** Off on a single-department board, where the column is one repeated word. */
  showDepartment?: boolean;
};

export default function BoardReturnWatch({
  rows, loading, activeKey, onSelect, showDepartment = true,
}: Props): React.ReactElement {
  const [tab, setTab] = useState<ReturnWatchKey>('overdue');
  const buckets = useMemo(() => returnWatchBuckets(rows), [rows]);
  const current = buckets.find((b) => b.key === tab);
  const listed = (current?.rows ?? []).slice(0, SHOWN);
  const total = current?.value ?? 0;
  const drillKey = `watch-${tab}`;

  return (
    <section className="card p-5 flex flex-col min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h2 className="card-title border-0 pb-0">RGP Return Watch</h2>
        <span className="text-caption text-navy-500 shrink-0">
          {loading ? '—' : `${buckets.reduce((s, b) => s + b.value, 0)} still out`}
        </span>
      </div>

      <div className="overflow-x-auto -mx-1 px-1 mb-3">
        <div className="tab-group flex-nowrap">
          {buckets.map((b) => (
            <button
              key={b.key}
              type="button"
              aria-pressed={b.key === tab}
              onClick={() => setTab(b.key as ReturnWatchKey)}
              className={`${b.key === tab ? 'tab-active' : 'tab-inactive'} whitespace-nowrap flex items-center gap-2`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: RETURN_WATCH_COLORS[b.key] }}
                aria-hidden="true"
              />
              {RETURN_WATCH_LABEL[b.key as ReturnWatchKey]} ({loading ? '—' : b.value})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="skeleton h-10 w-full" />
          ))}
        </div>
      ) : listed.length === 0 ? (
        <div className="empty-state">Nothing {RETURN_WATCH_LABEL[tab].toLowerCase()}.</div>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5">
          <table className="table-base min-w-[760px]">
            <thead>
              <tr>
                <th>RGP ID</th>
                <th>Material / Item</th>
                {showDepartment && <th>Department</th>}
                <th>Sent To</th>
                <th>Out Date</th>
                <th>Due Date</th>
                <th className="text-right">Days Overdue</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {listed.map((p) => {
                // Recomputed per row from the same function the tabs use, so a
                // row can never carry a pill that disagrees with the tab it is
                // sitting under.
                const key = returnWatchKeyOf(p) ?? tab;
                const late = daysOverdue(p);
                return (
                  <tr key={p.id}>
                    <td className="font-semibold text-navy-900 whitespace-nowrap">
                      <Link to={`/pass/${p.id}`} className="hover:underline">
                        {p.pass_number}
                      </Link>
                    </td>
                    <td className="max-w-[12rem] truncate" title={p.material_summary ?? undefined}>
                      {p.material_summary || '—'}
                    </td>
                    {showDepartment && <td className="max-w-[8rem] truncate">{p.department_name || '—'}</td>}
                    <td className="max-w-[9rem] truncate">{parseCompanyInfo(p.visitor_company).name || '—'}</td>
                    <td className="whitespace-nowrap text-navy-500">{formatDateOnly(p.verified_at)}</td>
                    <td className="whitespace-nowrap">{formatDateOnly(p.expected_return_date)}</td>
                    <td className="text-right tabular">{late > 0 ? late : '—'}</td>
                    <td>
                      <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md whitespace-nowrap ${PILL[key]}`}>
                        {RETURN_WATCH_PILL[key]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && total > 0 && (
        <button
          type="button"
          aria-pressed={activeKey === drillKey}
          onClick={() =>
            onSelect({
              key: drillKey,
              heading: `${RETURN_WATCH_LABEL[tab]} — still out`,
              empty: 'Nothing in this bucket.',
              rows: current?.rows ?? [],
            })
          }
          className="text-caption font-semibold text-accent-600 hover:underline mt-3 self-start"
        >
          View all {RETURN_WATCH_LABEL[tab].toLowerCase()} ({total}) →
        </button>
      )}
    </section>
  );
}
