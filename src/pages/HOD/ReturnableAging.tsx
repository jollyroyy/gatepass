// Returnable-aging table for the HOD dashboard — split out of Dashboard.tsx
// to stay under the 300-line cap. Pure presentation: takes the RPC's rows and
// a loading flag, renders nothing while loading or empty.
import React from 'react';
import type { ReturnableAgingBucket } from '../../types';
import { formatCurrency } from '../../lib/formatCurrency';

const BUCKET_LABEL: Record<string, string> = {
  '0-7d': '0–7 days',
  '8-30d': '8–30 days',
  '31-90d': '31–90 days',
  '90+': '90+ days',
};

export default function ReturnableAging({
  rows,
  loading,
}: {
  rows: ReturnableAgingBucket[];
  loading: boolean;
}): React.ReactElement | null {
  if (loading || rows.length === 0) return null;
  return (
    <div className="mb-8">
      <h2 className="section-title mb-3">Returnable Aging</h2>
      <div className="table-wrap">
        <table className="table-base">
          <thead>
            <tr>
              <th>Period</th>
              <th>Items Out</th>
              <th>Estimated Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bucket}>
                <td className="font-semibold text-navy-900">{BUCKET_LABEL[r.bucket] ?? r.bucket}</td>
                <td className="tabular">{r.item_count}</td>
                <td className="tabular">{formatCurrency(r.total_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
