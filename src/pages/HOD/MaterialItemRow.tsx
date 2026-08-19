// Single repeater row for the Material Items grid in RaisePass.tsx.
//
// One `.item-grid` per row, sharing the exact same column template as the
// header in MaterialItemsCard.tsx via `itemGridStyle()` — this is what keeps
// every row's fields lined up into real columns instead of drifting per row.
// THERE IS NO RETURN-DATE COLUMN HERE ANY MORE (client, 2026-08-19: "the
// return date of all individual items in the pass should be the expected
// return date of the entire pass") — the deadline is collected once, on
// PassDetailsCards, and every item is written with that same date at submit.
//
// Below `md` the grid collapses to one column and each field shows its own
// name via `data-label` (CSS-generated content in `.item-cell::before` —
// see index.css for why this is not a real `<label>` element). The
// accessible name for every input comes from `aria-label` regardless of
// breakpoint.
import React from 'react';
import type { NewGatePassItem } from '../../types';
import { isWholeUnit, unitLabel } from '../../lib/units';
import { itemGridStyle } from './materialItemGrid';

// The units a line can be raised in. `bag`, `drum` and `lot` were added on
// 2026-08-19 from the client's Pending RGP Return mock-up — a gate that counts
// cement in bags and paint in drums cannot record either as a bare number.
export const UNITS = [
  'nos', 'kg', 'box', 'roll', 'litre', 'metre', 'set', 'bag', 'drum', 'lot',
] as const;

interface MaterialItemRowErrors {
  name?: string;
  description?: string;
  purpose?: string;
  quantity?: string;
}

interface MaterialItemRowProps {
  item: NewGatePassItem;
  idx: number;
  errors: MaterialItemRowErrors;
  onChange: (field: keyof NewGatePassItem, value: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}

export default function MaterialItemRow({
  item,
  idx,
  errors,
  onChange,
  onRemove,
  canRemove,
}: MaterialItemRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5 p-3 bg-surface-50 rounded-lg">
      <span className="text-xs font-bold text-navy-500">Item #{idx + 1}</span>

      <div className="item-grid" style={itemGridStyle()}>
        <div className="item-cell" data-label="Item Name">
          <input
            className="input text-sm w-full"
            aria-label="Item Name"
            placeholder="Item name"
            value={item.name}
            onChange={(e) => onChange('name', e.target.value)}
          />
          {errors.name && <p className="field-error">{errors.name}</p>}
        </div>

        <div className="item-cell" data-label="Description">
          <input
            className="input text-sm w-full"
            aria-label="Description"
            placeholder="Description (brand, model, details)"
            value={item.description}
            onChange={(e) => onChange('description', e.target.value)}
          />
          {errors.description && <p className="field-error">{errors.description}</p>}
        </div>

        <div className="item-cell" data-label="Serial / ID">
          <input
            className="input text-sm w-full"
            aria-label="Serial / ID"
            placeholder="Serial / ID (optional)"
            value={item.serial_no}
            onChange={(e) => onChange('serial_no', e.target.value)}
          />
        </div>

        <div className="item-cell" data-label="Purpose">
          <input
            className="input text-sm w-full"
            aria-label="Purpose"
            placeholder="Reason for taking out"
            value={item.purpose}
            onChange={(e) => onChange('purpose', e.target.value)}
          />
          {errors.purpose && <p className="field-error">{errors.purpose}</p>}
        </div>

        <div className="item-cell" data-label="Qty">
          {/* A counted unit takes no fraction — `step` follows the unit chosen
            * in the next cell, so the browser's own arrows and its validation
            * agree with `validateRaiseForm`, which enforces the same rule
            * through `isWholeUnit`. */}
          <input
            type="number"
            min={isWholeUnit(item.unit) ? '1' : '0.01'}
            step={isWholeUnit(item.unit) ? '1' : '0.01'}
            className="input text-sm w-full"
            aria-label="Quantity"
            placeholder="Qty"
            value={item.quantity}
            onChange={(e) => onChange('quantity', e.target.value)}
          />
          {errors.quantity && <p className="field-error">{errors.quantity}</p>}
        </div>

        <div className="item-cell" data-label="Unit">
          <select
            className="input text-sm w-full"
            aria-label="Unit"
            value={item.unit}
            onChange={(e) => onChange('unit', e.target.value)}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>{unitLabel(u)}</option>
            ))}
          </select>
        </div>

        <div className="item-cell" data-label="Value (₹)">
          <div className="relative">
            <input
              type="number"
              min="0"
              step="0.01"
              className="input text-sm w-full pl-5"
              aria-label="Approx Value"
              placeholder="Approx Value"
              value={item.approx_value}
              onChange={(e) => onChange('approx_value', e.target.value)}
            />
            <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-navy-500 text-xs font-semibold">
              &#x20B9;
            </span>
          </div>
        </div>

        {/* Remove control's own fixed-width column — always occupies the
            slot so it never floats after variable-width content, even when
            it renders nothing (the last item can't be removed). */}
        <div className="item-cell items-center justify-center pt-1 md:pt-0">
          {canRemove ? (
            <button
              type="button"
              className="text-flagged-500 hover:text-flagged-700 text-xl leading-none shrink-0"
              onClick={onRemove}
              title="Remove item"
              aria-label={`Remove item ${idx + 1}`}
            >
              &times;
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
      </div>
    </div>
  );
}
