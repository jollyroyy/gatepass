// "Items in this Pass (5)" — the material lines of ONE open RGP, and the
// column a guard actually works in (client mock-up, 2026-08-19).
//
// EVERY LINE IS ITS OWN RETURN. The mock's RETURN NOW column carries a
// "+ Add Return" button per line, and pressing it opens the box that takes a
// QUANTITY: 800 of the 1,000 litres of diesel that went out is a complete,
// normal answer, and until this screen existed the only return the UI offered
// was the whole outstanding balance of a line. A line whose material is all
// back reads "✓ Returned" and offers no button, because there is nothing left
// to return and `apply_item_returns` would refuse it. A line the guard has
// STAGED keeps its button — reading "Staged 250" — even when that quantity
// closes the line, because a figure that has not been sent yet must stay
// correctable without discarding the whole draft.
//
// WHAT IS SHOWN IS RECORDED + STAGED. `effectiveReturned` folds the guard's
// unsent entries into every figure and badge here, so the panel already looks
// the way it will after the Record press — and the row is tinted while it is
// still only a draft, so "looks done" and "is done" are never confused.
//
// THE UNIT IS NAMED ONCE. The mock draws a UOM column beside each quantity;
// this app names a shared unit in the heading and leaves the cells bare, and
// never names `nos` at all (`src/lib/units.ts`, a settled client call). Lines
// that DISAGREE keep their own unit in the cell, which is the case that
// matters here — a pass of 200 L of diesel and 10 drums of paint. The one
// screen that does carry a UOM COLUMN is Pending OUT (client, 2026-08-19):
// there the guard is counting a load out through the barrier line by line.
import React from 'react';
import type { GatePassItemView } from '../../types';
import {
  effectiveReturned,
  formatQty,
  lineState,
  lineStateLabel,
  LINE_STATE_PILL,
  type ReturnDraft,
} from '../../lib/returnDraft';
import { headingUnit, quantityCell, quantityHeading, unitLabel } from '../../lib/units';

const TickGlyph = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);

type Props = {
  items: GatePassItemView[];
  draft: ReturnDraft;
  /** Opens the Add Return box on this line. Null while a return is in flight. */
  onAdd: ((item: GatePassItemView) => void) | null;
};

export default function PendingReturnItems({ items, draft, onAdd }: Props): React.ReactElement {
  const units = items.map((i) => i.unit);
  const shared = headingUnit(units);
  const totalExpected = items.reduce((n, i) => n + i.quantity, 0);
  const totalBack = items.reduce((n, i) => n + effectiveReturned(i, draft), 0);

  return (
    <table className="gb-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Item Name</th>
          <th>Description</th>
          <th>{quantityHeading('Expected Qty', units)}</th>
          <th>{quantityHeading('Returned Qty', units)}</th>
          <th>Return Now</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => {
          const state = lineState(item, draft);
          const staged = draft[item.id] !== undefined;
          return (
            <tr key={item.id} className={staged ? 'gb-row-staged' : undefined}>
              <td>{i + 1}</td>
              <td>{item.name}</td>
              <td className="gb-truncate" title={item.description || undefined}>
                {item.description || '—'}
              </td>
              <td>{quantityCell(item.quantity, item.unit, units)}</td>
              <td>{quantityCell(effectiveReturned(item, draft), item.unit, units)}</td>
              <td>
                {state === 'returned' && !staged ? (
                  <span className="gb-pill gb-pill-green">
                    {TickGlyph}
                    Returned
                  </span>
                ) : (
                  <button
                    type="button"
                    className="gb-add-btn"
                    disabled={onAdd === null}
                    onClick={() => onAdd?.(item)}
                    aria-label={`${staged ? 'Edit' : 'Add'} return for ${item.name}`}
                  >
                    {staged ? `Staged ${formatQty(draft[item.id].qty)}` : '+ Add Return'}
                  </button>
                )}
              </td>
              <td>
                <span className={`gb-pill ${LINE_STATE_PILL[state]}`}>
                  {lineStateLabel(item, draft, shared ? '' : unitLabel(item.unit))}
                </span>
                {/* A staged line says so even when the quantity CLOSES it: a
                  * green "Returned" with nothing beside it would read as
                  * recorded, and it is not until the Record press. */}
                {staged && <span className="gb-subline">Not recorded yet</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
      {/* The mock's Total row. It sums quantities across lines, which is only
        * meaningful when they share a unit — so it is drawn only then, rather
        * than printing the sum of 200 litres and 10 drums. */}
      {shared !== null && (
        <tfoot>
          <tr>
            <td colSpan={3}>Total</td>
            <td>{formatQty(totalExpected)}</td>
            <td>{formatQty(totalBack)}</td>
            <td colSpan={2}>
              {totalExpected === 0
                ? '0% Returned'
                : `${Math.round((totalBack / totalExpected) * 1000) / 10}% Returned`}
            </td>
          </tr>
        </tfoot>
      )}
    </table>
  );
}
