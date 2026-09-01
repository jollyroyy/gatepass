// The material lines of the pass that was just raised, inside the confirmation
// popup (client, 2026-09-01: "in the success pop-up you show all the details,
// like how many quantities, what is the material item, everything … how much
// worth of item").
//
// The popup used to state a count and nothing else, because `raise_pass`
// returns a `gatepass.gate_passes` ROW — no roll-ups, no lines. This reads the
// lines back through `usePassItems`, the same one-pass item read the record and
// the gate screens use, so the confirmation quotes the DATABASE's copy of what
// was raised rather than the form's.
//
// It is deliberately a read of its own and not a prop: the form's items carry
// the strings the HOD typed, and what matters here is what the pass now holds.
import React from 'react';
import type { GatePassItemView } from '../../types';
import { usePassItems } from '../../lib/usePassItems';
import { quantityCell } from '../../lib/units';
import { formatCurrency } from '../../lib/formatCurrency';

/** One line: what it is, how much of it, and what it is worth. */
function ItemLine({ item }: { item: GatePassItemView }): React.ReactElement {
  return (
    <li className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-navy-800 truncate">
          <span className="text-navy-500 font-mono mr-1.5">{item.line_no}.</span>
          {item.name}
        </p>
        {item.make_model && <p className="text-[11px] text-navy-500 truncate">{item.make_model}</p>}
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-navy-950">{quantityCell(item.quantity, item.unit)}</p>
        {/* An unpriced line prints nothing rather than ₹0 — "no value was
            declared" is a different claim from "this is worth nothing". */}
        {item.approx_value != null && item.approx_value > 0 && (
          <p className="text-[11px] text-navy-500">{formatCurrency(item.approx_value)}</p>
        )}
      </div>
    </li>
  );
}

export default function SubmittedItemsList({ passId }: { passId: string }): React.ReactElement {
  const { items } = usePassItems(passId);

  // `undefined` is still loading, `[]` is a real (if unexpected) answer — the
  // same distinction `usePassItems` draws everywhere else.
  if (items === undefined) return <div className="skeleton h-10 mt-2" />;
  if (items.length === 0) return <React.Fragment />;

  return (
    <ul className="mt-2.5 divide-y divide-surface-200 border-t border-surface-200">
      {items.map((item) => (
        <ItemLine key={item.id} item={item} />
      ))}
    </ul>
  );
}
