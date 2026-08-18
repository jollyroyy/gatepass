// "Items requiring attention" — one row per overdue MATERIAL LINE, longest
// delay first, in the client's reference layout (2026-08-18).
//
// THREE COLUMNS OF THE REFERENCE ARE THIS APP'S, NOT THE REFERENCE'S:
//
//   EMPLOYEE   → CARRIED BY. The gate records who took the material out
//                (`visitor_name`); it does not hold an employee directory.
//   DELAY      → whole days, because `expected_return_date` is a `date` column.
//                "1d 7h" would be an hours figure nothing in the database
//                supports.
//   ACTION     → View pass, and — at the gate only — Mark returned. The
//                reference's "Contact employee" and "Escalate" have no
//                mechanism in this system, and a button that does nothing is
//                worse than no button.
//
// A TAP SAVES NOTHING. "Mark returned" ticks the row; the Record bar under the
// table is what reaches the database. Same settled rule as ItemReturnList and
// the Scheduled Returns table: `apply_item_returns` has no undo.
import React from 'react';
import { Link } from 'react-router-dom';
import type { ReturnsPage } from '../../lib/scheduledReturns';
import { formatDelay, OVERDUE_STYLES, type OverdueRow } from '../../lib/overdueItems';
import { formatDateOnly } from '../../lib/formatDate';
import { quantityCell, quantityHeading } from '../../lib/units';
import Badge from '../Badge';
import TablePager from '../TablePager';

type Props = {
  page: ReturnsPage<OverdueRow>;
  /** Units of EVERY row, not just this page — a heading that changed as the
   *  reader paged would be a different table on every page. */
  units: (string | null | undefined)[];
  picked: Set<string>;
  onToggle: (itemId: string) => void;
  onPage: (page: number) => void;
  busy: boolean;
  /** False for an HOD and an admin: only the gate records a return, and
   *  `apply_item_returns` refuses anyone else. */
  canRecord: boolean;
};

export default function OverdueTable({
  page, units, picked, onToggle, onPage, busy, canRecord,
}: Props): React.ReactElement {
  return (
    <div className="card overflow-hidden" data-testid="overdue-table">
      <div className="px-5 pt-4 pb-3">
        <h2 className="card-title">Items requiring attention</h2>
        <p className="text-caption text-navy-500">Sorted by longest delay</p>
      </div>

      <div className="overflow-x-auto">
        <table className="table-base">
          <thead>
            <tr>
              <th>Item</th>
              <th>Gate Pass</th>
              <th>Carried By</th>
              <th>Department</th>
              <th>Expected Return</th>
              <th>{quantityHeading('Quantity', units)}</th>
              <th>Delay</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map(({ item, pass, expectedReturn, daysLate, severity }) => {
              const ticked = picked.has(item.id);
              return (
                <tr key={item.id}>
                  <td>
                    <span className="flex items-center gap-2.5">
                      <span className="w-7 h-7 rounded-md bg-surface-200 flex items-center justify-center shrink-0">
                        <svg className="w-4 h-4 text-navy-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 8.25L12 4.5l8.25 3.75-8.25 3.75L3.75 8.25z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12L12 15.75 20.25 12M3.75 15.75L12 19.5l8.25-3.75" />
                        </svg>
                      </span>
                      <span className="font-semibold text-navy-900">{item.name}</span>
                    </span>
                  </td>
                  <td>
                    <Link to={`/pass/${pass.id}`} className="text-accent-600 hover:underline font-medium whitespace-nowrap">
                      {pass.pass_number}
                    </Link>
                  </td>
                  <td className="text-navy-700">{pass.visitor_name}</td>
                  <td className="text-navy-700">{pass.department_name}</td>
                  <td className="font-semibold text-navy-900 whitespace-nowrap">
                    {formatDateOnly(expectedReturn)}
                  </td>
                  <td>
                    <span className="inline-flex items-center justify-center min-w-[1.75rem] px-2 py-0.5 rounded-md bg-surface-200 text-navy-800 text-xs font-semibold">
                      {quantityCell(item.outstanding_qty, item.unit, units)}
                    </span>
                  </td>
                  <td className={`font-semibold whitespace-nowrap ${
                    severity === 'critical' ? 'text-flagged-600' : 'text-overdue-600'
                  }`}>
                    {formatDelay(daysLate)}
                  </td>
                  <td>
                    <Badge style={OVERDUE_STYLES[severity]} />
                  </td>
                  <td>
                    {canRecord ? (
                      <button
                        type="button"
                        className={`font-medium text-sm whitespace-nowrap hover:underline ${
                          ticked ? 'text-navy-500' : 'text-accent-600'
                        }`}
                        onClick={() => onToggle(item.id)}
                        disabled={busy}
                      >
                        {ticked ? 'Undo' : 'Mark returned'}
                      </button>
                    ) : (
                      <Link to={`/pass/${pass.id}`} className="text-accent-600 hover:underline font-medium text-sm whitespace-nowrap">
                        View pass
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <TablePager page={page} onPage={onPage} />
    </div>
  );
}
