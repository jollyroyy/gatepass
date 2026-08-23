// "Items in this gate pass" — the material lines of a gate pass, drawn to the
// client's mock-up (2026-08-19, latest attachment): a progress line over the
// table, one row per line, and the return status carrying the moment it came
// back.
//
// PRESENTATIONAL ONLY. It holds no state and calls no RPC — the draft, the
// return box and the commit all live in `PassRecordReturns.tsx`, so the table
// can be rendered read-only (an HOD, an admin, a closed pass) by simply not
// passing `canRecord`.
//
// QUANTITY IS ONE COLUMN AND IT NAMES ITS OWN UNIT. Client, 2026-08-19: "the
// column heading should be Quantity and under that the values would be 3 L or
// 3 kg as per the item" — so the separate Unit, Qty Returned and Pending Qty
// columns are gone, and the cell carries the issued figure with its unit and,
// under it, the SECOND number the client asked for: how much has actually come
// back. The unit is named on every line — lines on one pass can be in different
// units, and since 2026-08-23 no screen in this app moves a unit into a column
// heading or drops it for being a plain count.
//
// SERIAL / ID IS A REAL COLUMN NOW, on BOTH pass types (client: "put the serial
// number against all the items, in both the passes"). `gate_pass_items.serial_no`
// has always existed and `raise_pass` has always accepted it; the raise form
// simply never sent one, which is why this column used to print em dashes and
// was replaced by the line's ordinal. The ordinal stays as "#" — it is the
// line's position, not its identity.
//
// THE RETURN DATE IS THE SYSTEM'S, NEVER TYPED. `returned_at` is stamped by
// `apply_item_returns` when a line goes FULLY back (029), so a partly-returned
// line deliberately shows no date rather than borrowing the pass's. And it is
// final: a recorded return cannot be undone anywhere in this app.
//
// AN NRGP KEEPS THE STATUS COLUMN AND LOSES THE ACTION ONE. Its lines read
// "Closed" — the material left for good, which IS an outcome (client,
// 2026-08-18: an NRGP is closed, never "in use") — but there is nothing to
// press on a line that is never coming back.
import React from 'react';
import type { GatePassItemView, GatePassView } from '../../types';
import { formatCurrency } from '../../lib/formatCurrency';
import { formatDateTime } from '../../lib/formatDate';
import { unitLabel } from '../../lib/units';
import { itemLineView, itemReturnStage, passWasRejected, returnProgress } from '../../lib/passRecordView';
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

/** "3 Kg", "3 Numbers" — the figure and the line's own unit, ALWAYS (client,
 *  2026-08-23: "whatever unit has been selected, you need to show all of them,
 *  no matter what"). `nos` used to print bare here; it no longer does anywhere. */
function qtyWithUnit(qty: number, unit: string | null | undefined): string {
  const n = formatQty(qty);
  return unit ? `${n} ${unitLabel(unit)}` : n;
}

export default function PassRecordItems({
  pass, items, draft, canRecord, onAdd, onDiscard,
}: Props): React.ReactElement {
  const isRgp = pass.type === 'RGP';
  // THE PASS WAS REFUSED, so no line on it is "pending" anything — see
  // `passWasRejected`. Every figure about the return leg is withheld with it:
  // "0 of 2 items returned" describes an obligation that never began.
  const rejected = passWasRejected(pass);
  // Counted on the DRAFT-INCLUSIVE quantities, so the bar moves with the table
  // it sits over rather than describing the pass as it was before staging.
  const staged = items.map((i) => ({ ...i, returned_qty: effectiveReturned(i, draft) }));
  const progress = returnProgress(staged, pass.type);
  // THE VALUE COLUMN IS FOOTED (client, 2026-08-19: "overall the total value
  // also"). Only the priced lines are added — an unpriced one contributes
  // nothing, never a zero — and a table where no line carries a value gets no
  // foot at all rather than a ₹0 nobody entered.
  const priced = items.filter((i) => i.approx_value != null);
  const totalValue = priced.reduce((sum, i) => sum + Number(i.approx_value), 0);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <h2 className="card-title mb-0 pb-0 border-0">Items in this gate pass</h2>
        {isRgp && !rejected && items.length > 0 && (
          <div className="flex items-center gap-3 min-w-[220px]">
            <span className="text-sm text-navy-500 whitespace-nowrap">
              {progress.returned} of {progress.total} items returned
            </span>
            <span className="text-sm font-semibold text-navy-900 tabular">{progress.percent}%</span>
            {/* The bar repeats the figure beside it for a reader who takes a
                shape faster than a number; it carries no fact of its own. */}
            <span className="h-2 w-24 rounded-full bg-surface-200 overflow-hidden" aria-hidden="true">
              <span
                className="block h-full bg-accent-600"
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
                <th>#</th>
                <th>Item</th>
                <th>Description</th>
                {/* MAKE / MODEL / BRAND IS A COLUMN, not a line of small print
                    under the item's name (client, 2026-08-23: "put the make,
                    model and brand name against each item across all the
                    views … like in the expandable card"). The expandable
                    stacked card had given it a column since 045 and this table
                    had not, so the same pass read two ways depending on which
                    screen opened it. */}
                <th>Make / Model</th>
                <th>Serial / ID</th>
                <th>Quantity</th>
                <th>Value</th>
                <th>{isRgp && !rejected ? 'Return Status' : 'Status'}</th>
                {isRgp && !rejected && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => {
                const draftLine = draft[item.id];
                const returned = effectiveReturned(item, draft);
                const pending = effectiveOutstanding(item, draft);
                // The line's own return stage decides whether it still OWES
                // material (which is what the Action column is for); the words
                // on the badge come from `itemLineView`, which repeats the
                // pass's own status unless this line has a return of its own.
                const staging = { quantity: item.quantity, returned_qty: returned };
                const stage = itemReturnStage(staging, pass.type);
                const owes = !rejected && (stage === 'pending' || stage === 'partial');

                return (
                  <tr key={item.id} className={draftLine ? 'bg-accent-50/60' : undefined}>
                    <td className="tabular text-navy-500">{index + 1}</td>
                    <td className="font-semibold text-navy-900">
                      {item.name}
                    </td>
                    <td className="text-navy-500">
                      {item.description || ''}
                      {/* Invoice/Reference No. and Remarks (045) — free text with
                          no column of its own on the mock-up, so each folds in
                          here only when the HOD actually typed one. Existing
                          rows have neither and print exactly as before. */}
                      {item.invoice_no && (
                        <span className="block text-caption text-navy-500">Inv/Ref: {item.invoice_no}</span>
                      )}
                      {item.remarks && (
                        <span className="block text-caption text-navy-500">Note: {item.remarks}</span>
                      )}
                    </td>
                    {/* Null on every line raised before migration 045. EMPTY,
                        never an em dash: this table's own rule, the one Serial
                        / ID follows and the one csvCells.ts states — a dash
                        breaks a sort and a SUM in every export of it. */}
                    <td className="text-navy-700">{item.make_model || ''}</td>
                    <td className="text-navy-700 tabular">{item.serial_no || ''}</td>
                    <td className="tabular">
                      {qtyWithUnit(item.quantity, item.unit)}
                      {/* The second number: what has actually come back. Drawn
                        * only once some has — "Returned 0" on an untouched line
                        * is noise on every row of a fresh pass. */}
                      {isRgp && !rejected && returned > 0 && (
                        <span className="block text-caption text-navy-500 whitespace-nowrap">
                          Returned {qtyWithUnit(returned, item.unit)}
                        </span>
                      )}
                      {isRgp && !rejected && returned > 0 && pending > 0 && (
                        <span className="block text-caption text-flagged-700 font-semibold whitespace-nowrap">
                          Pending {qtyWithUnit(pending, item.unit)}
                        </span>
                      )}
                    </td>
                    <td>{item.approx_value != null ? formatCurrency(item.approx_value) : ''}</td>
                    <td>
                      <Badge style={itemLineView(staging, pass)} />
                        {/* WHEN it came back, written by the database, not by a
                          * guard: `returned_at` is stamped only once a line is
                          * FULLY back (029), so a partly-returned line carries
                          * no date and must not invent one. */}
                      {item.returned_at && (
                        <span className="block text-caption text-navy-500 mt-1 whitespace-nowrap">
                          {formatDateTime(item.returned_at)}
                        </span>
                      )}
                        {/* A staged line looks done and is not. Saying so on the
                          * line itself is the whole reason the draft exists. */}
                      {draftLine && (
                        <span className="block text-caption text-accent-700 font-semibold mt-1">
                          Not recorded yet
                        </span>
                      )}
                    </td>
                    {isRgp && !rejected && (
                      <td>
                        {canRecord && owes && onAdd ? (
                          <button
                            type="button"
                            className="text-accent-600 hover:underline font-medium text-sm whitespace-nowrap"
                            onClick={() => onAdd(item)}
                          >
                            {draftLine ? 'Edit return' : 'Mark return'}
                          </button>
                        ) : draftLine && onDiscard ? (
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
            {priced.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={6} className="text-right font-semibold text-navy-700">Total Value</td>
                  <td data-testid="items-total-value" className="tabular font-semibold text-navy-900">
                    {formatCurrency(totalValue)}
                  </td>
                  <td colSpan={isRgp && !rejected ? 2 : 1} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}
