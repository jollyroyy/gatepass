// Single repeater row for the Material Items card in RaisePass.tsx.
import React from 'react';
import type { NewGatePassItem } from '../../types';

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
    <div className="flex flex-col gap-2 p-3 bg-surface-50 rounded-lg">
      <span className="text-xs font-bold text-navy-400">Item #{idx + 1}</span>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[140px]">
          <input className="input text-sm w-full" placeholder="Item name" value={item.name}
            onChange={(e) => onChange('name', e.target.value)} />
          {errors.name && <p className="field-error">{errors.name}</p>}
        </div>
        <div className="flex-[2] min-w-[200px]">
          <input className="input text-sm w-full" placeholder="Description (brand, model, details)" value={item.description}
            onChange={(e) => onChange('description', e.target.value)} />
          {errors.description && <p className="field-error">{errors.description}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex-1 min-w-[160px]">
          <input className="input text-sm w-full" placeholder="Reason for taking out" value={item.purpose}
            onChange={(e) => onChange('purpose', e.target.value)} />
          {errors.purpose && <p className="field-error">{errors.purpose}</p>}
        </div>
        {showReturnDate && (
          <div className="w-[160px]">
            <label className="label !text-[11px]" htmlFor={`item-return-${idx}`}>Return Date</label>
            <input id={`item-return-${idx}`} type="date" className="input text-sm w-full" value={item.expected_return_date}
              onChange={(e) => onChange('expected_return_date', e.target.value)}
              min={todayStr} />
            {errors.expected_return_date && (
              <p className="field-error">{errors.expected_return_date}</p>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div>
          <input type="number" min="0.01" step="0.01" className="input w-16 text-sm" placeholder="Qty"
            value={item.quantity} onChange={(e) => onChange('quantity', e.target.value)} />
          {errors.quantity && <p className="field-error">{errors.quantity}</p>}
        </div>
        <select className="input w-20 text-sm" value={item.unit}
          onChange={(e) => onChange('unit', e.target.value)}>
          {UNITS.map((u) => (<option key={u} value={u}>{u}</option>))}
        </select>
        <div className="relative">
          <input type="number" min="0" step="0.01" className="input w-28 text-sm pl-5" placeholder="Approx Value"
            value={item.approx_value} onChange={(e) => onChange('approx_value', e.target.value)} />
          <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-navy-500 text-xs font-semibold">&#x20B9;</span>
        </div>
        {canRemove && (
          <button type="button" className="text-flagged-500 hover:text-flagged-700 text-xl leading-none pb-0.5 shrink-0"
            onClick={onRemove} title="Remove item">&times;</button>
        )}
      </div>
    </div>
  );
}
