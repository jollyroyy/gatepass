// "Material Items" card for RaisePass.tsx — wraps the MaterialItemRow repeater.
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
  showReturnDate: boolean;
  onItemChange: (idx: number, field: keyof NewGatePassItem, value: string) => void;
  onRemoveItem: (idx: number) => void;
  onAddItem: () => void;
  todayStr: string;
}

const HEADER_LABELS = ['Item Name', 'Description', 'Purpose', 'Qty', 'Unit', 'Value (₹)'] as const;

export default function MaterialItemsCard({
  items,
  errors,
  showReturnDate,
  onItemChange,
  onRemoveItem,
  onAddItem,
  todayStr,
}: MaterialItemsCardProps): React.ReactElement {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="card-title mb-0">Material Items</h2>
        <span className="text-xs font-medium text-navy-500 bg-surface-100 px-2 py-1 rounded-full">{items.length} item{items.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ONE horizontal scroll container for the header AND every row — they
          must scroll together or the columns would stop lining up the moment
          the card is narrower than the grid. `.item-grid-track`'s min-width is
          the grid's own minimum (itemGridMinWidth), which is what makes each
          row's grey frame at least as wide as the fields inside it; without it
          the fields overflowed the frame. Below `md` the min-width is dropped
          (index.css) because the grid collapses to a single stacked column. */}
      <div className="item-grid-scroll">
        <div className="item-grid-track" style={{ minWidth: itemGridMinWidth(showReturnDate) }}>
          <div className="item-grid hidden md:grid mb-1 px-3" style={itemGridStyle(showReturnDate)}>
            {HEADER_LABELS.map((label) => (
              <span key={label} className="text-micro text-navy-500 uppercase">
                {label}
              </span>
            ))}
            {showReturnDate && <span className="text-micro text-navy-500 uppercase">Return Date</span>}
            <span aria-hidden="true" />
          </div>

          <div className="flex flex-col gap-2">
            {items.map((item, idx) => (
              <MaterialItemRow
                key={idx}
                item={item}
                idx={idx}
                showReturnDate={showReturnDate}
                errors={{
                  name: errors[`item_${idx}_name`],
                  description: errors[`item_${idx}_description`],
                  purpose: errors[`item_${idx}_purpose`],
                  expected_return_date: errors[`item_${idx}_expected_return_date`],
                  quantity: errors[`item_${idx}_quantity`],
                }}
                onChange={(field, value) => onItemChange(idx, field, value)}
                onRemove={() => onRemoveItem(idx)}
                canRemove={items.length > 1}
                todayStr={todayStr}
              />
            ))}
          </div>
        </div>
      </div>
      <button type="button" className="btn-secondary mt-3 w-full" onClick={onAddItem}>
        + Add Item
      </button>
      {errors.items && <p className="field-error mt-2">{errors.items}</p>}
    </div>
  );
}
