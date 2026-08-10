// Single repeater row for the Material Items grid in RaisePass.tsx.
//
// One `.item-grid` per row, sharing the exact same column template as the
// header in MaterialItemsCard.tsx via `itemGridStyle()` — this is what keeps
// every row's fields lined up into real columns instead of drifting per row.
// The Return Date column HOLDS ITS PLACE for RGP and is simply omitted (not
// rendered blank) for NRGP, so it is never the reason two rows disagree on
// width; `showReturnDate` is passed straight through to the shared grid
// template so the row and the header can never disagree about it either.
//
// Below `md` the grid collapses to one column and each field shows its own
// name via `data-label` (CSS-generated content in `.item-cell::before` —
// see index.css for why this is not a real `<label>` element). The
// accessible name for every input comes from `aria-label` regardless of
// breakpoint, which is also what lets `getByLabelText('Return Date')` find
// each row's date input without a per-row visible label duplicating the
// column header's text.
import React from 'react';
import type { NewGatePassItem } from '../../types';
import { itemGridStyle } from './materialItemGrid';

export const UNITS = ['nos', 'kg', 'box', 'roll', 'litre', 'metre', 'set'] as const;

interface MaterialItemRowErrors {
  name?: string;
  description?: string;
  purpose?: string;
  expected_return_date?: string;
  quantity?: string;
}

interface MaterialItemRowProps {
  item: NewGatePassItem;
  idx: number;
  showReturnDate: boolean;
  errors: MaterialItemRowErrors;
  onChange: (field: keyof NewGatePassItem, value: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  todayStr: string;
}

export default function MaterialItemRow({
  item,
  idx,
  showReturnDate,
  errors,
  onChange,
  onRemove,
  canRemove,
  todayStr,
}: MaterialItemRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5 p-3 bg-surface-50 rounded-lg">
      <span className="text-xs font-bold text-navy-400">Item #{idx + 1}</span>

      <div className="item-grid" style={itemGridStyle(showReturnDate)}>
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
          <input
            type="number"
            min="0.01"
            step="0.01"
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
              <option key={u} value={u}>{u}</option>
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

        {showReturnDate && (
          <div className="item-cell" data-label="Return Date">
            <input
              type="date"
              className="input text-sm w-full"
              aria-label="Return Date"
              value={item.expected_return_date}
              onChange={(e) => onChange('expected_return_date', e.target.value)}
              min={todayStr}
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
