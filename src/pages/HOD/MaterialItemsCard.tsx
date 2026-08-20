// "Item-wise Details" — the repeater table at the foot of the raise form,
// drawn to the client's 2026-08-19 mock-up.
//
// The header row below is the ONE place each column's name is written — see
// MaterialItemRow.tsx / materialItemGrid.ts / index.css's `.item-grid` for
// how it shares its column template with every row so nothing drifts out of
// alignment. It renders only at `md` and above; below that each row becomes
// its own stacked card (CSS-only collapse, no separate mobile markup).
import React from 'react';
import type { NewGatePassItem } from '../../types';
import MaterialItemRow from './MaterialItemRow';
import { itemGridMinWidth, itemGridStyle } from './materialItemGrid';

interface MaterialItemsCardProps {
  items: NewGatePassItem[];
  errors: Record<string, string | undefined>;
  onItemChange: (idx: number, field: keyof NewGatePassItem, value: string) => void;
  onRemoveItem: (idx: number) => void;
  onAddItem: () => void;
  /** RGP only: the per-line "Expected Return Date" column (client, 2026-08-19).
   *  Passed down to every row AND to the grid template, so the header and the
   *  rows always agree on how many columns there are. */
  showReturnDate: boolean;
}

/** Column name, and whether the mock marks it required. Same order as
 *  `itemGridColumns()`; the trailing Action column is the header's own last
 *  cell, not a spacer, because the mock names it. */
const HEADERS: { label: string; required?: boolean }[] = [
  { label: '#' },
  { label: 'Item Description', required: true },
  { label: 'Quantity', required: true },
  { label: 'Unit', required: true },
  // NOT required: a line whose worth nobody knows is left blank, and a blank is
  // a different claim from a zero (client, 2026-08-20 — the field is back).
  { label: 'Approx. Value (Rs)' },
  { label: 'Make / Model / Size', required: true },
  { label: 'Serial / Asset Tag' },
  { label: 'Invoice / Reference No.' },
  { label: 'Remarks' },
];

/** The RGP-only column, spliced in before Action. Required: material that goes
 *  out on a returnable pass has to be due back on a day. */
const RETURN_DATE_HEADER = { label: 'Expected Return Date', required: true };
const ACTION_HEADER: { label: string; required?: boolean } = { label: 'Action' };

export default function MaterialItemsCard({
  items,
  errors,
  onItemChange,
  onRemoveItem,
  onAddItem,
  showReturnDate,
}: MaterialItemsCardProps): React.ReactElement {
  const headers = [...HEADERS, ...(showReturnDate ? [RETURN_DATE_HEADER] : []), ACTION_HEADER];
  return (
    <section className="rp-section">
      <h2 className="rp-legend">Item-wise Details</h2>

      {/* ONE horizontal scroll container for the header AND every row — they
          must scroll together or the columns would stop lining up the moment
          the card is narrower than the grid. `.item-grid-track`'s min-width is
          the grid's own minimum (itemGridMinWidth), which is what makes each
          row's frame at least as wide as the fields inside it; without it the
          fields overflowed the frame. Below `md` the min-width is dropped
          (index.css) because the grid collapses to a single stacked column. */}
      <div className="item-grid-scroll rp-table">
        <div className="item-grid-track" style={{ minWidth: itemGridMinWidth(showReturnDate) }}>
          <div className="item-grid rp-table-head hidden md:grid" style={itemGridStyle(showReturnDate)}>
            {headers.map((h) => (
              <span key={h.label} className="rp-th">
                {h.label}
                {h.required && <span className="rp-req" aria-hidden="true"> *</span>}
              </span>
            ))}
          </div>

          <div className="rp-table-body">
            {items.map((item, idx) => (
              <MaterialItemRow
                key={idx}
                item={item}
                idx={idx}
                errors={{
                  name: errors[`item_${idx}_name`],
                  make_model: errors[`item_${idx}_make_model`],
                  quantity: errors[`item_${idx}_quantity`],
                  approx_value: errors[`item_${idx}_approx_value`],
                  expected_return_date: errors[`item_${idx}_expected_return_date`],
                }}
                onChange={(field, value) => onItemChange(idx, field, value)}
                onRemove={() => onRemoveItem(idx)}
                canRemove={items.length > 1}
                showReturnDate={showReturnDate}
              />
            ))}
          </div>
        </div>
      </div>

      <button type="button" className="rp-add-row" onClick={onAddItem}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v8M8 12h8" strokeLinecap="round" />
        </svg>
        Add Another Item
      </button>
      {errors.items && <p className="field-error mt-2">{errors.items}</p>}
    </section>
  );
}
