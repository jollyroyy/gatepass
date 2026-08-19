// The material lines of ONE pass, inside an opened stacked card (client,
// 2026-08-19: "mention serial number beside each item, both for RGP and NRGP,
// and the value of the items individually in INR in the stacked cards").
//
// Until now a card said "Material: 2 items" and stopped there: the per-line
// figures existed only on the full record and on the guard's queue panels, so
// an HOD reading their own register could not see which line was the ₹40,000
// one without opening a second screen. PassRowBody's own header used to say
// value was out of reach here because it fetched nothing; it fetches now.
//
// ON DEMAND, AND ONLY WHILE THE CARD IS OPEN. `usePassItems` is the same read
// the guard's queue rows make — one small query per disclosure, thrown away on
// close. A list of fifty collapsed cards makes no queries at all.
//
// THE ORDINAL IS THE SERIAL NUMBER. `gate_pass_items.serial_no` is write-dead
// (nothing in this app sets it), so a column of em dashes would be worse than
// none; the line's position is the number a reader counts a physical load
// against, and it is the same "#" the two guard panels already print.
import React from 'react';
import { formatCurrency } from '../lib/formatCurrency';
import { quantityCell, quantityHeading } from '../lib/units';
import { usePassItems } from '../lib/usePassItems';

export default function PassItemLines({
  passId,
  dense = false,
}: {
  passId: string;
  dense?: boolean;
}): React.ReactElement | null {
  const { items, error } = usePassItems(passId);

  if (error) return <p className="text-caption text-flagged-600">{error}</p>;
  if (items === undefined) return <div className="skeleton h-16 w-full" />;
  if (items.length === 0) return null;

  const units = items.map((i) => i.unit);
  // THE PRICED LINES ONLY (client, 2026-08-19: "overall the total value also").
  // An unpriced line contributes nothing rather than a zero — the same rule the
  // cell follows: nobody entered a figure, and a zero would be a claim. When no
  // line carries one there is nothing to total, so no foot is drawn.
  const priced = items.filter((i) => i.approx_value != null);
  const totalValue = priced.reduce((sum, i) => sum + Number(i.approx_value), 0);

  return (
    <div className="overflow-x-auto">
      <table className="table-base" data-testid="pass-item-lines">
        <thead>
          <tr>
            <th className="w-8">#</th>
            <th>Item</th>
            <th>{quantityHeading('Quantity', units)}</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={item.id}>
              <td className="tabular-nums text-navy-500">{i + 1}</td>
              <td className={dense ? 'text-sm' : undefined}>
                <span className="font-semibold text-navy-900">{item.name}</span>
                {item.description && (
                  <span className="block text-caption text-navy-500">{item.description}</span>
                )}
              </td>
              <td className="tabular-nums">{quantityCell(item.quantity, item.unit, units)}</td>
              {/* An unpriced line is an empty cell, not ₹0 — nobody entered a
                  figure, and a zero is a claim that the material is worthless. */}
              <td className="tabular-nums font-semibold text-navy-900">
                {item.approx_value != null ? formatCurrency(item.approx_value) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        {priced.length > 0 && (
          <tfoot>
            <tr>
              <td colSpan={3} className={`text-right font-semibold text-navy-700 ${dense ? 'text-sm' : ''}`}>
                Total Value
              </td>
              <td
                data-testid="item-lines-total"
                className="tabular-nums font-semibold text-navy-900"
              >
                {formatCurrency(totalValue)}
              </td>
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
