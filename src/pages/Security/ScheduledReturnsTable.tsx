// The Scheduled Returns table — presentation only. One row per material line,
// in the layout the client supplied on 2026-08-18: a progress header, a flat
// table, and a pager under it.
//
// TWO COLUMNS OF THE MOCK-UP ARE THIS APP'S, NOT THE MOCK'S. There is no
// `condition` column anywhere in `gatepass.gate_pass_items`, so that slot
// carries QUANTITY — a real field — rather than a column of em-dashes that
// would read as data loss. "Employee" is the person who carried the material
// out (`visitor_name`), which is what the gate actually records.
//
// The unit rides in the QUANTITY heading when every line shares one, and `nos`
// is never named — see src/lib/units.ts.
import React from 'react';
import { Link } from 'react-router-dom';
import type { ReturnsPage, ScheduledReturnRow } from '../../lib/scheduledReturns';
import { ITEM_RETURN_STYLES } from '../../lib/passRecordView';
import { formatDateOnly } from '../../lib/formatDate';
import { quantityCell, quantityHeading } from '../../lib/units';
import Badge from '../../components/Badge';

type Props = {
  page: ReturnsPage<ScheduledReturnRow>;
  /** Units of EVERY row, not just this page — a heading that changed as the
   *  reader paged would be a different table on every page. */
  units: (string | null | undefined)[];
  picked: Set<string>;
  onToggle: (itemId: string) => void;
  onPage: (page: number) => void;
  busy: boolean;
};

export default function ScheduledReturnsTable({
  page, units, picked, onToggle, onPage, busy,
}: Props): React.ReactElement {
  return (
    <div className="card overflow-hidden" data-testid="scheduled-returns-table">
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
              <th>Return Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.map(({ item, pass, stage, expectedReturn }) => {
              const owes = item.outstanding_qty > 0;
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
                    {expectedReturn ? formatDateOnly(expectedReturn) : '—'}
                  </td>
                  <td>
                    <span className="inline-flex items-center justify-center min-w-[1.75rem] px-2 py-0.5 rounded-md bg-surface-200 text-navy-800 text-xs font-semibold">
                      {quantityCell(item.quantity, item.unit, units)}
                    </span>
                  </td>
                  <td>
                    {/* A tick is not a fact yet: the row keeps its database
                        stage until Record is pressed. */}
                    <Badge style={ITEM_RETURN_STYLES[stage]} />
                  </td>
                  <td>
                    {owes ? (
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
                      <Link to={`/pass/${pass.id}`} className="text-accent-600 hover:underline font-medium text-sm">
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-t border-surface-200/60">
        <span className="text-sm text-navy-500">
          Showing {page.from}–{page.to} of {page.total}
        </span>
        {page.pages > 1 && (
          <div className="flex items-center gap-1">
            <PagerButton label="Previous page" disabled={page.page === 1} onClick={() => onPage(page.page - 1)}>
              ‹
            </PagerButton>
            {Array.from({ length: page.pages }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                type="button"
                aria-current={n === page.page ? 'page' : undefined}
                onClick={() => onPage(n)}
                className={`min-w-[2rem] h-8 px-2 rounded-lg text-sm font-medium border transition-colors ${
                  n === page.page
                    ? 'border-brand-600 text-brand-800 dark:text-brand-300 bg-brand-600/10'
                    : 'border-surface-200 text-navy-600 hover:border-surface-300'
                }`}
              >
                {n}
              </button>
            ))}
            <PagerButton label="Next page" disabled={page.page === page.pages} onClick={() => onPage(page.page + 1)}>
              ›
            </PagerButton>
          </div>
        )}
      </div>
    </div>
  );
}

function PagerButton({
  label, disabled, onClick, children,
}: {
  label: string; disabled: boolean; onClick: () => void; children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="min-w-[2rem] h-8 px-2 rounded-lg text-sm border border-surface-200 text-navy-600
                 hover:border-surface-300 disabled:opacity-40 disabled:cursor-default"
    >
      {children}
    </button>
  );
}
