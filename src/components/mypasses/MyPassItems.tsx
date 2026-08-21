// The material lines of ONE pass, opened inside its own stacked card (client,
// 2026-08-20: "upon clicking on it they might be able to see the exact items
// also in the stacked card").
//
// LOADED ON DEMAND, one card at a time, through the same `usePassItems` the
// guard's Pending OUT row uses — a page of twenty passes must not make twenty
// item queries for tables nobody opened. Closing the card throws the rows away
// rather than caching a set `apply_item_returns` could invalidate underneath.
//
// IT IS A READING, NOT A CONTROL. Nothing here acts on a line; recording a
// return is the guard's, on the record. The card is a list row that can be
// unfolded, and the pass number beside it still opens the full record.
//
// The unit is named beside the QUANTITY COLUMN when every line shares one and
// it is not `nos` — `quantityHeading` / `quantityCell`, the rule every quantity
// table in this app follows, so a count of 3 reads "3" and never "3 Numbers".
import React from 'react';
import type { GatePassView } from '../../types';
import { formatCurrency } from '../../lib/formatCurrency';
import { quantityCell, quantityHeading } from '../../lib/units';
import { usePassItems } from '../../lib/usePassItems';
import { itemLineView } from '../../lib/passRecordView';
import { itemPillClass } from '../../lib/passStackCard';

export default function MyPassItems({ pass }: { pass: GatePassView }): React.ReactElement {
  const { items, error } = usePassItems(pass.id);

  if (error) return <div className="mp-items mp-items-note">{error}</div>;
  if (items === undefined) return <div className="mp-items mp-items-note">Loading items…</div>;
  if (items.length === 0) return <div className="mp-items mp-items-note">No material lines on this pass.</div>;

  const units = items.map((i) => i.unit);

  return (
    <div className="mp-items">
      <div className="gb-scroll">
        <table className="gb-table mp-items-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Item</th>
              <th scope="col">Description</th>
              <th scope="col">{quantityHeading('Quantity', units)}</th>
              <th scope="col">Value</th>
              {/* The line's own status — the pass's own badge, unless this line
                  is fully or partly back. One function, `itemLineView`. */}
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((line, i) => (
              <tr key={line.id}>
                <td>{i + 1}</td>
                <td>{line.name}</td>
                <td>{line.description || '—'}</td>
                <td>{quantityCell(line.quantity, line.unit, units)}</td>
                {/* An unpriced line is a dash, never ₹0 — `approx_value` is
                    optional, and "nothing declared" is not "declared zero". */}
                <td>{line.approx_value === null ? '—' : formatCurrency(line.approx_value)}</td>
                <td>
                  <span className={itemPillClass(line, pass)}>{itemLineView(line, pass).label}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
