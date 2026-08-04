// Single repeater row for the Material Lines section in BulkRaise.tsx.
import React from 'react';
import type { NewGatePassItem } from '../../types';

interface BulkItemRowProps {
  item: NewGatePassItem;
  idx: number;
  showReturnDate: boolean;
  errors: Record<string, string | undefined>;
  onChange: (idx: number, field: keyof NewGatePassItem, value: string) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
  todayStr: string;
}

export default function BulkItemRow({
  item,
  idx,
  showReturnDate,
  errors,
  onChange,
  onRemove,
  canRemove,
  todayStr,
}: BulkItemRowProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 mb-3 p-3 bg-surface-50 rounded-lg">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[140px]">
          <input className={`input ${errors[`item_${idx}_name`] ? 'input-error' : ''}`} placeholder="Item name" value={item.name}
            onChange={(e) => onChange(idx, 'name', e.target.value)} />
        </div>
        <div className="flex-1 min-w-[140px]">
          <input className={`input ${errors[`item_${idx}_description`] ? 'input-error' : ''}`} placeholder="Description" value={item.description}
            onChange={(e) => onChange(idx, 'description', e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-[2] min-w-[180px]">
          <input className="input" placeholder="Purpose" value={item.purpose}
            onChange={(e) => onChange(idx, 'purpose', e.target.value)} />
        </div>
        {showReturnDate && (
          <div className="w-[170px]">
            <input type="date" className="input" min={todayStr} value={item.expected_return_date}
              onChange={(e) => onChange(idx, 'expected_return_date', e.target.value)} />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="label !text-[11px] !mb-1" htmlFor={`bulk-qty-${idx}`}>Qty</label>
          <input id={`bulk-qty-${idx}`} type="number" min="0.01" step="0.01" className={`input w-20 ${errors[`item_${idx}_quantity`] ? 'input-error' : ''}`}
            value={item.quantity} onChange={(e) => onChange(idx, 'quantity', e.target.value)} />
          {errors[`item_${idx}_quantity`] && <p className="field-error">{errors[`item_${idx}_quantity`]}</p>}
        </div>
        <div>
          <label className="label !text-[11px] !mb-1" htmlFor={`bulk-unit-${idx}`}>Unit</label>
          <input id={`bulk-unit-${idx}`} className="input w-20" value={item.unit}
            onChange={(e) => onChange(idx, 'unit', e.target.value)} placeholder="nos" />
        </div>
        <div className="flex-1 min-w-[120px]">
          <input type="number" min="0" step="0.01" className="input" placeholder="Approx value" value={item.approx_value}
            onChange={(e) => onChange(idx, 'approx_value', e.target.value)} />
        </div>
        <button type="button" className="btn-danger btn-sm" disabled={!canRemove}
          onClick={() => onRemove(idx)}>×</button>
      </div>
    </div>
  );
}
