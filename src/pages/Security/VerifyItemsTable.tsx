// What the guard is actually being asked to release, line by line.
//
// Verify used to fetch these rows and render none of them — it showed
// `material_summary` ("Drill Machine, Ladder") and "2 line(s)", so the two facts
// that decide whether to open the barrier were missing: WHY each item is moving,
// and what it is worth. A guard cannot sanity-check a ₹2,00,000 load against a
// gate pass that never mentions a value.
//
// The pass-level `purpose` column is NOT a fallback here. Migration 019 moved
// the reasons onto the items and RaisePass never sends p_purpose, so it is null
// on every HOD-raised pass; only Bulk Create still fills it.
import React from 'react';
import type { GatePassItemView } from '../../types';
import { formatDateOnly } from '../../lib/formatDate';
import ItemOrdinal from '../../components/ItemOrdinal';

/** Indian digit grouping — ₹14,500 not ₹14.5K. A guard reads this against a
 *  delivery note, so it must match the figure written on the paper. */
export function formatRupees(n: number | null | undefined): string {
  if (n == null) return '—';
  return `₹${n.toLocaleString('en-IN')}`;
}

type Props = {
  items: GatePassItemView[];
  /** RGP shows per-item return dates; NRGP has nothing to come back. */
  showReturnDates: boolean;
  totalQuantity: number;
};

export default function VerifyItemsTable({ items, showReturnDates, totalQuantity }: Props): React.ReactElement {
  // Summed from the lines actually on screen, so the total can never disagree
  // with the rows above it. A line with no declared value contributes nothing
  // rather than breaking the sum.
  const declaredValue = items.reduce((sum, i) => sum + (i.approx_value ?? 0), 0);
  const anyValueDeclared = items.some((i) => i.approx_value != null);

  return (
    <div className="card p-6 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 className="card-title mb-0">Material</h2>
        <span className="text-sm font-medium text-navy-500 tabular">
          {items.length} item{items.length !== 1 ? 's' : ''} · {totalQuantity} total qty
          {anyValueDeclared && (
            <>
              {' · '}
              <span className="font-bold text-navy-900">{formatRupees(declaredValue)}</span>
              <span className="text-navy-500"> declared</span>
            </>
          )}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-navy-500 italic">No item lines recorded on this pass.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item, i) => (
            <div key={item.id} className="rounded-xl bg-surface-50 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
                <div className="min-w-0 flex items-center gap-2.5">
                  <ItemOrdinal index={i + 1} total={items.length} />
                  <span className="font-semibold text-navy-900">{item.name}</span>
                  {/* Make / Model / Size (045) — shown here, unlike Invoice/Ref
                      or Remarks, because it is the one new field that helps a
                      guard match the physical item against the pass at the
                      barrier ("Dell Latitude 5420" vs. just "Laptop"); an
                      invoice number is an accounts fact, not a barrier one. */}
                  {item.make_model && (
                    <span className="text-sm text-navy-500">({item.make_model})</span>
                  )}
                  <span className="text-navy-300 mx-1.5" aria-hidden="true">·</span>
                  <span className="text-sm text-navy-500">{item.description}</span>
                </div>
                <div className="flex items-baseline gap-3 shrink-0">
                  <span className="text-sm font-semibold text-navy-800 tabular">
                    {item.quantity} {item.unit}
                  </span>
                  <span className="text-sm font-bold text-brand-700 tabular">
                    {formatRupees(item.approx_value)}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <div className="min-w-0">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">Reason</span>
                  <p className="text-sm text-navy-700">{item.purpose}</p>
                </div>
                {showReturnDates && item.expected_return_date && (
                  <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
                      Expected Return
                    </span>
                    <p className="text-sm text-navy-700 tabular">{formatDateOnly(item.expected_return_date)}</p>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
