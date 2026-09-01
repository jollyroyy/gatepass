// Single repeater row for the "Item-wise Details" table on RaisePass.tsx.
//
// One `.item-grid` per row, sharing the exact same column template as the
// header in MaterialItemsCard.tsx via `itemGridStyle()` — this is what keeps
// every row's fields lined up into real columns instead of drifting per row.
//
// THE RETURN DATE IS BACK, PER LINE, ON AN RGP ONLY (client, 2026-08-19: "we
// would expect a date of return against each item in the RGP form"). The PASS's
// own deadline — the column the overdue grading reads — is the earliest of
// them, computed at submit, so there is one place to type a date.
//
// THE UNIT IS ASKED FOR AGAIN, as a dropdown beside the quantity (client,
// 2026-08-20). It is what decides whether that quantity may carry a fraction:
// `isWholeUnit` is the one rule, and the native `min`/`step` here follow it so
// the browser's own arrows agree with `validateRaiseForm` and with the gate's
// return box.
//
// THE APPROXIMATE VALUE IS ASKED FOR AGAIN, on BOTH pass types (client,
// 2026-08-20: "make a field for the HOD to input the approx value for each item
// in our GP and RGP form"). It is OPTIONAL and stays optional: a line nobody
// has priced is blank, `raise_pass` stores null, and `total_value` adds only
// the lines that carry one — a required field would force somebody to invent a
// figure that then prints on the record as if it were declared.
//
// WHAT THIS ROW STILL DOES NOT ASK FOR: the PURPOSE, which is asked once for
// the whole pass.
//
// Below `md` the grid collapses to one column and each field shows its own
// name via `data-label` (CSS-generated content in `.item-cell::before` —
// see index.css for why this is not a real `<label>` element). The
// accessible name for every input comes from `aria-label` regardless of
// breakpoint.
import React from 'react';
import type { NewGatePassItem } from '../../types';
import { itemGridStyle } from './materialItemGrid';
import { todayStr } from '../../lib/raisePassForm';
import { UNIT_OPTIONS, isWholeUnit } from '../../lib/units';

interface MaterialItemRowErrors {
  name?: string;
  make_model?: string;
  quantity?: string;
  approx_value?: string;
  expected_return_date?: string;
}

interface MaterialItemRowProps {
  item: NewGatePassItem;
  idx: number;
  errors: MaterialItemRowErrors;
  onChange: (field: keyof NewGatePassItem, value: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  /** RGP only — an NRGP draws no date column at all. */
  showReturnDate: boolean;
}

export default function MaterialItemRow({
  item,
  idx,
  errors,
  onChange,
  onRemove,
  canRemove,
  showReturnDate,
}: MaterialItemRowProps): React.ReactElement {
  const whole = isWholeUnit(item.unit);
  return (
    <div className="item-grid item-row" style={itemGridStyle(showReturnDate)}>
      {/* The mock's leading "#" column. It is the line number a guard reads off
          the slip over radio, so it is drawn, not implied by position. */}
      <div className="item-cell item-line-no" data-label="#">
        <span>{idx + 1}</span>
      </div>

      <div className="item-cell" data-label="Item Description">
        <input
          className="input text-sm w-full"
          aria-label="Item Description"
          placeholder="Enter item description"
          value={item.name}
          onChange={(e) => onChange('name', e.target.value)}
        />
        {errors.name && <p className="field-error">{errors.name}</p>}
      </div>

      <div className="item-cell" data-label="Quantity">
        {/* The unit decides the step: a COUNTED unit (box, bag, lot…) takes no
          * fraction, a MEASURED one (kg, litre, metre) does — `isWholeUnit` is
          * the one rule and `validateRaiseForm` reads the same function, so the
          * browser's own arrows agree with the submit. */}
        <input
          type="number"
          min={whole ? '1' : '0.01'}
          step={whole ? '1' : '0.01'}
          className="input text-sm w-full"
          aria-label="Quantity"
          placeholder="Enter quantity"
          value={item.quantity}
          onChange={(e) => onChange('quantity', e.target.value)}
        />
        {errors.quantity && <p className="field-error">{errors.quantity}</p>}
      </div>

      <div className="item-cell" data-label="Unit">
        {/* Every code `unitLabel` knows, offered under the very label the guard
          * reads back off the pass — see UNIT_OPTIONS. */}
        <select
          className="input text-sm w-full"
          aria-label="Unit"
          value={item.unit}
          onChange={(e) => onChange('unit', e.target.value)}
        >
          {UNIT_OPTIONS.map((u) => (
            <option key={u.code} value={u.code}>
              {u.label}
            </option>
          ))}
        </select>
      </div>

      <div className="item-cell" data-label="Approx. Value (Rs)">
        {/* Rupees, and never negative. `step="0.01"` regardless of the unit —
          * money takes paise even when the material is counted in whole boxes,
          * so `isWholeUnit` deliberately has nothing to do with this field. */}
        <input
          type="number"
          min="0"
          step="0.01"
          className="input text-sm w-full"
          aria-label="Approx. Value (Rs)"
          placeholder="Enter approx. value"
          value={item.approx_value}
          onChange={(e) => onChange('approx_value', e.target.value)}
        />
        {errors.approx_value && <p className="field-error">{errors.approx_value}</p>}
      </div>

      <div className="item-cell" data-label="Make / Model / Size">
        <input
          className="input text-sm w-full"
          aria-label="Make / Model / Size"
          placeholder="Enter make / model / size"
          value={item.make_model}
          onChange={(e) => onChange('make_model', e.target.value)}
        />
        {errors.make_model && <p className="field-error">{errors.make_model}</p>}
      </div>

      <div className="item-cell" data-label="Serial / Asset Tag">
        <input
          className="input text-sm w-full"
          aria-label="Serial / Asset Tag"
          placeholder="Enter serial / asset tag"
          value={item.serial_no}
          onChange={(e) => onChange('serial_no', e.target.value)}
        />
      </div>

      {/* ORDER NO. — the client's own word for this box (2026-09-01), and the
          word the column has always meant: `invoice_no` is where the order /
          reference number the material came in on is typed. The COLUMN keeps
          its name; renaming it would be a migration for a caption. */}
      <div className="item-cell" data-label="Order No.">
        <input
          className="input text-sm w-full"
          aria-label="Order No."
          placeholder="Enter order no."
          value={item.invoice_no}
          onChange={(e) => onChange('invoice_no', e.target.value)}
        />
      </div>

      <div className="item-cell" data-label="Remarks">
        <input
          className="input text-sm w-full"
          aria-label="Remarks"
          placeholder="Enter remarks"
          value={item.remarks}
          onChange={(e) => onChange('remarks', e.target.value)}
        />
      </div>

      {showReturnDate && (
        <div className="item-cell" data-label="Expected Return Date">
          <input
            type="date"
            className="input text-sm w-full"
            aria-label="Expected Return Date"
            value={item.expected_return_date}
            min={todayStr()}
            onChange={(e) => onChange('expected_return_date', e.target.value)}
          />
          {errors.expected_return_date && <p className="field-error">{errors.expected_return_date}</p>}
        </div>
      )}

      {/* Remove control's own fixed-width column — always occupies the
          slot so it never floats after variable-width content, even when
          it renders nothing (the last item can't be removed). */}
      <div className="item-cell items-center justify-center pt-1 md:pt-0">
        {canRemove ? (
          <button
            type="button"
            className="rp-trash"
            onClick={onRemove}
            title="Remove item"
            aria-label={`Remove item ${idx + 1}`}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
              <path d="M10 11v6M14 11v6" />
            </svg>
          </button>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
