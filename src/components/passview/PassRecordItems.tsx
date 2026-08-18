// "Items in this gate pass" — every material line of a searched pass, with the
// return progress bar above it and a per-line action on the right.
//
// The column set is this app's, not a generic one: there is no `category` and
// no `condition` column anywhere in `gatepass.gate_pass_items`, so those two
// slots carry DESCRIPTION and VALUE — real fields, same layout. Inventing a
// column of em-dashes would look like data loss.
//
// The action link is decided by the line's own stage, never by the pass: a
// line still owing material sends the guard to Pending Returns, which is the
// only screen that can record one (`apply_item_returns`). A settled line just
// opens the pass. A button that always fails is worse than no button.
import React from 'react';
import { Link } from 'react-router-dom';
import type { GatePassItemView, GatePassView } from '../../types';
import { formatCurrency } from '../../lib/formatCurrency';
import { ITEM_RETURN_STYLES, itemReturnStage, returnProgress } from '../../lib/passRecordView';
import { quantityCell, quantityHeading } from '../../lib/units';
import Badge from '../Badge';

type Props = { pass: GatePassView; items: GatePassItemView[] };

export default function PassRecordItems({ pass, items }: Props): React.ReactElement {
  const progress = returnProgress(items, pass.type);
  const isRgp = pass.type === 'RGP';
  // The unit rides in the column NAME when every line shares one, so the cells
  // stay bare numbers — see src/lib/units.ts.
  const units = items.map((i) => i.unit);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="card-title mb-0 pb-0 border-0">Items in this gate pass</h2>
        {isRgp && progress.total > 0 && (
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm text-navy-500 whitespace-nowrap">
              {progress.returned} of {progress.total} items returned
            </span>
            <span className="text-sm font-semibold text-navy-900 tabular">{progress.percent}%</span>
            <span className="h-2 w-32 sm:w-48 rounded-full bg-surface-200 overflow-hidden">
              <span
                className="block h-full rounded-full bg-accent-600"
                style={{ width: `${progress.percent}%` }}
              />
            </span>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">No material lines recorded on this pass.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>Item</th>
                <th>Description</th>
                <th>Serial / ID</th>
                <th>{quantityHeading('Quantity', units)}</th>
                <th>Value</th>
                <th>Return Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const stage = itemReturnStage(item, pass.type);
                const owes = stage === 'pending' || stage === 'partial';
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
                    <td className="text-navy-500">{item.description || '—'}</td>
                    <td className="font-mono text-xs">{item.serial_no || '—'}</td>
                    <td>
                      <span className="inline-flex items-center justify-center min-w-[1.75rem] px-2 py-0.5 rounded-md bg-surface-200 text-navy-800 text-xs font-semibold">
                        {quantityCell(item.quantity, item.unit, units)}
                      </span>
                    </td>
                    <td>{item.approx_value != null ? formatCurrency(item.approx_value) : '—'}</td>
                    <td><Badge style={ITEM_RETURN_STYLES[stage]} /></td>
                    <td>
                      <Link
                        to={owes ? '/returns' : `/pass/${pass.id}`}
                        className="text-accent-600 hover:underline font-medium text-sm whitespace-nowrap"
                        aria-label={`${owes ? 'Mark return' : 'View'} — ${item.name}`}
                      >
                        {owes ? 'Mark return' : 'View'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
