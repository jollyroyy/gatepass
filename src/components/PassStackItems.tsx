// THE MATERIAL LINES OF ONE PASS, UNFOLDED INSIDE ITS OWN STACKED CARD (client,
// 2026-08-20: "for each stacked card there is an option to expand the stacked
// card, also just to see the details about the item and its individual item
// details … before Approval or rejection").
//
// It exists for the APPROVER's queue: signing a pass without reading what is on
// it is the one thing the ladder is there to prevent, and opening the record to
// find out costs the reader their place in the queue. `PassStackCard` draws it
// only when a list asks for it (`expandable`), so every other stack in the app
// is untouched and still a plate that only links.
//
// LOADED ON DEMAND, one card at a time, through the same `usePassItems` the
// guard's Pending OUT row and the HOD's My Passes card use — a page of twenty
// passes must not fire twenty item queries for tables nobody opened. Closing
// the card throws the rows away rather than caching a set the database could
// invalidate underneath it.
//
// IT IS A READING, NOT A CONTROL. Nothing here acts on a line — the decision is
// the two buttons on the card's right and the bar at the foot of the record,
// and a control inside a panel that appears under a button is a control nobody
// expects. `invoice_no` is deliberately absent: it is an accounts fact, the same
// call the guard's Verify table makes.
//
// The unit is named beside the QUANTITY COLUMN when every line shares one and
// it is not `nos` — `quantityHeading` / `quantityCell`, the rule every quantity
// table in this app follows, so a count of 3 reads "3" and never "3 Numbers".
import React from 'react';
import type { GatePassView } from '../types';
import { formatCurrency } from '../lib/formatCurrency';
import { quantityCell, quantityHeading } from '../lib/units';
import { usePassItems } from '../lib/usePassItems';
import { ITEM_LINE_STYLES, itemLineStage } from '../lib/passRecordView';
import { ITEM_STAGE_PILL } from '../lib/passStackCard';

export default function PassStackItems({ pass }: { pass: GatePassView }): React.ReactElement {
  const { items, error } = usePassItems(pass.id);

  if (error) return <div className="gpo-items gpo-items-note">{error}</div>;
  if (items === undefined) return <div className="gpo-items gpo-items-note">Loading items…</div>;
  if (items.length === 0) {
    return <div className="gpo-items gpo-items-note">No material lines on this pass.</div>;
  }

  const units = items.map((i) => i.unit);

  return (
    <div className="gpo-items" data-testid="pass-stack-items">
      <div className="gb-scroll">
        <table className="gb-table gpo-items-table">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Item</th>
              <th scope="col">Description</th>
              <th scope="col">Make / Model</th>
              <th scope="col">Serial / ID</th>
              <th scope="col">Purpose</th>
              <th scope="col">{quantityHeading('Quantity', units)}</th>
              <th scope="col">Value</th>
              {/* THE LINE'S OWN STATUS. A refused pass reads "Rejected" on every
                  line of it (client, 2026-08-20: "show the status also as
                  rejected against each individual item … everywhere, not only
                  the pass"), and a live one reads where its return leg stands —
                  one function, `itemLineStage`, shared with the record. */}
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((line, i) => {
              const stage = itemLineStage(line, pass);
              return (
              <tr key={line.id}>
                <td>{i + 1}</td>
                <td>{line.name}</td>
                <td>{line.description || '—'}</td>
                {/* Null on every line raised before migration 045. */}
                <td>{line.make_model || '—'}</td>
                <td>{line.serial_no || '—'}</td>
                <td>{line.purpose || '—'}</td>
                <td>{quantityCell(line.quantity, line.unit, units)}</td>
                {/* An unpriced line is a dash, never ₹0 — `approx_value` is
                    optional, and "nothing declared" is not "declared zero". */}
                <td>{line.approx_value === null ? '—' : formatCurrency(line.approx_value)}</td>
                <td>
                  <span className={ITEM_STAGE_PILL[stage]}>{ITEM_LINE_STYLES[stage].label}</span>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
