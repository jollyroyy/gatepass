// The material lines of a gate pass, drawn to the client's mock-up: numbered,
// with the unit named on every line, the issued and returned quantities side by
// side, what is still pending, and a total row under all of it.
//
// PRESENTATIONAL ONLY. It holds no state and calls no RPC — the draft, the
// return box and the commit all live in `PassRecordReturns.tsx`, so the table
// can be rendered read-only (an HOD, an admin, a closed pass) by simply not
// passing `canRecord`.
//
// THE UNIT HAS ITS OWN COLUMN HERE, and that is a deliberate exception to the
// `quantityHeading`/`quantityCell` rule the rest of the app follows. On this
// screen a reader is checking a physical load against one line at a time —
// exactly the argument that put the column back on Pending OUT — and three
// quantity columns sharing one unit named in a heading is a heading trying to
// govern three cells at once.
//
// THE ORDINAL IS THE SERIAL NUMBER. `serial_no` is write-dead, so a column of
// em dashes would say less than the line's own position, which is what the
// mock-up's "#" is.
//
// AN NRGP HAS NO RETURN COLUMNS AT ALL. It is not coming back; Qty Returned and
// Pending Qty would be a column of zeroes describing an obligation that never
// existed.
import React from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import { formatCurrency } from '../../lib/formatCurrency';
import { formatDateOnly } from '../../lib/formatDate';
import { unitLabel } from '../../lib/units';
import { ITEM_RETURN_STYLES, itemReturnStage } from '../../lib/passRecordView';
import { effectiveReturned, effectiveOutstanding, formatQty, type ReturnDraft } from '../../lib/returnDraft';
import Badge from '../Badge';

type Props = {
  pass: GatePassView;
  items: GatePassItemView[];
  /** Quantities staged but NOT yet recorded. Every figure below includes them,
   *  so the table already looks the way it will after the press. */
  draft: ReturnDraft;
  /** Drawn only for a guard, and only while the pass still owes material —
   *  `canRecordReturns` restates the rule `apply_item_returns` enforces. */
  canRecord: boolean;
  onAdd?: (item: GatePassItemView) => void;
  onDiscard?: (itemId: string) => void;
};

function sum(items: GatePassItemView[], of: (i: GatePassItemView) => number): number {
  return items.reduce((total, i) => total + of(i), 0);
}

export default function PassRecordItems({
  pass, items, draft, canRecord, onAdd, onDiscard,
}: Props): React.ReactElement {
  const isRgp = pass.type === 'RGP';

  const issued = sum(items, (i) => i.quantity);
  const back = sum(items, (i) => effectiveReturned(i, draft));
  const value = sum(items, (i) => i.approx_value ?? 0);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="card-title mb-0 pb-0 border-0">
          {isRgp ? 'RGP Items (Returnable)' : 'NRGP Items (Non-Returnable)'}
        </h2>
        <span className="text-sm text-navy-500">
          {items.length} {items.length === 1 ? 'line' : 'lines'}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="empty-state">No material lines recorded on this pass.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>#</th>
                <th>Item Name</th>
                <th>Description</th>
                <th>Unit</th>
                <th>{isRgp ? 'Qty Issued' : 'Quantity'}</th>
                {isRgp && <th>Qty Returned</th>}
                {isRgp && <th>Pending Qty</th>}
                <th>Value</th>
                <th>Status</th>
                {isRgp && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const staged = draft[item.id];
                const returned = effectiveReturned(item, draft);
                const pending = effectiveOutstanding(item, draft);
                const stage = itemReturnStage(
                  { quantity: item.quantity, returned_qty: returned }, pass.type,
                );
                const owes = stage === 'pending' || stage === 'partial';

                return (
                  <tr key={item.id} className={staged ? 'bg-accent-50/60' : undefined}>
                    <td className="tabular text-navy-500">{index + 1}</td>
                    <td className="font-semibold text-navy-900">{item.name}</td>
                    <td className="text-navy-500">{item.description || '—'}</td>
                    <td className="text-navy-700">{unitLabel(item.unit)}</td>
                    <td className="tabular">{formatQty(item.quantity)}</td>
                    {isRgp && <td className="tabular">{formatQty(returned)}</td>}
                    {isRgp && (
                      <td className={`tabular ${pending > 0 ? 'text-flagged-700 font-semibold' : ''}`}>
                        {formatQty(pending)}
                      </td>
                    )}
                    <td>{item.approx_value != null ? formatCurrency(item.approx_value) : ''}</td>
                    <td>
                      <Badge style={ITEM_RETURN_STYLES[stage]} />
                      {/* WHEN it came back. `returned_at` is stamped only once a
                        * line is FULLY back (029), so a partly-returned line
                        * carries no date and must not invent one. */}
                      {item.returned_at && (
                        <span className="block text-caption text-navy-500 mt-1 whitespace-nowrap">
                          Returned {formatDateOnly(item.returned_at)}
                        </span>
                      )}
                      {/* A staged line looks done and is not. Saying so on the
                        * line itself is the whole reason the draft exists. */}
                      {staged && (
                        <span className="block text-caption text-accent-700 font-semibold mt-1">
                          Not recorded yet
                        </span>
                      )}
                    </td>
                    {isRgp && (
                      <td>
                        {canRecord && owes && onAdd ? (
                          <button
                            type="button"
                            className="text-accent-600 hover:underline font-medium text-sm whitespace-nowrap"
                            onClick={() => onAdd(item)}
                          >
                            {staged ? 'Edit return' : '+ Add Return'}
                          </button>
                        ) : staged && onDiscard ? (
                          <button
                            type="button"
                            className="text-flagged-600 hover:underline font-medium text-sm"
                            onClick={() => onDiscard(item.id)}
                          >
                            Discard
                          </button>
                        ) : (
                          <span className="text-navy-500 text-sm">NA</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            {/* The mock-up's Total row. It sums the SAME figures printed above
                it, staged quantities included, so the foot can never disagree
                with the body. */}
            <tfoot>
              <tr className="bg-surface-100 font-semibold text-navy-900">
                <td colSpan={4}>Total</td>
                <td className="tabular">{formatQty(issued)}</td>
                {isRgp && <td className="tabular">{formatQty(back)}</td>}
                {isRgp && (
                  <td className={`tabular ${issued - back > 0 ? 'text-flagged-700' : ''}`}>
                    {formatQty(issued - back)}
                  </td>
                )}
                <td>{value > 0 ? formatCurrency(value) : ''}</td>
                <td />
                {isRgp && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
