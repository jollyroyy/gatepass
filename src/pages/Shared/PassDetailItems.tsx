// The "Material Items" card on PassDetail — split out to keep PassDetail.tsx
// under the 300-line cap (2026-08-10, when item ordinals + emphasised value
// were added). Numbers each line (ItemOrdinal — suppressed for a single-item
// pass) and totals the declared value from the item rows PassDetail already
// loaded (no new query).
import React from 'react';
import type { GatePassItemView, PassType } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import { formatCurrency } from '../../lib/formatCurrency';
import ItemOrdinal from '../../components/ItemOrdinal';
import DetailRow from './DetailRow';

type Props = {
  items: GatePassItemView[];
  itemCount: number;
  passType: PassType;
};

export default function PassDetailItems({ items, itemCount, passType }: Props): React.ReactElement {
  const isRgp = passType === 'RGP';

  return (
    <div className="card p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 className="card-title mb-0 pb-0 border-0">Material Items ({itemCount})</h2>
        {/* Summed from the lines already loaded for this page — no new query.
            Emphasised per the client's ask; never a coloured background, just
            heavier weight. */}
        {items.some((i) => i.approx_value != null) && (
          <span className="text-sm text-navy-500">
            Total declared value{' '}
            <span className="font-semibold text-navy-950">
              {formatCurrency(items.reduce((sum, i) => sum + (i.approx_value ?? 0), 0))}
            </span>
          </span>
        )}
      </div>
      <div className="flex flex-col gap-4">
        {items.map((item, i) => (
          <div key={item.id} className="border border-navy-200 rounded-lg p-4 bg-surface-50">
            <div className="flex items-center gap-2.5 mb-2">
              <ItemOrdinal index={i + 1} total={items.length} />
              <span className="font-semibold text-navy-900">{item.name}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <DetailRow label="Description" value={item.description} />
              <DetailRow label="Purpose / Reason" value={item.purpose} />
              <DetailRow label="Quantity" value={`${item.quantity} ${item.unit}`} />
              <DetailRow
                label="Approx Value"
                value={item.approx_value != null ? formatCurrency(item.approx_value) : '—'}
                emphasize
              />
              {isRgp && (
                <DetailRow
                  label="Expected Return Date"
                  value={item.expected_return_date ? formatDateOnly(item.expected_return_date) : '—'}
                  emphasize
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
