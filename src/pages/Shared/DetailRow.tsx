// Shared label/value pair for PassDetail and PassDetailItems.
// `emphasize` bumps the value's weight only (never colour) — used for the
// four facts the client asked to read as primary: vendor, who raised it, and
// (RGP only) the expected return date and item value.
import React from 'react';

export default function DetailRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: React.ReactNode;
  emphasize?: boolean;
}): React.ReactElement {
  return (
    <div>
      <dt className="text-xs font-bold text-navy-500 uppercase tracking-wider">{label}</dt>
      <dd className={`text-sm mt-0.5 ${emphasize ? 'font-semibold text-navy-950' : 'text-navy-900'}`}>
        {value ?? '—'}
      </dd>
    </div>
  );
}
