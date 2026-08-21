// The block beside the item table on an open return row: who authorised the
// material, what vehicle it went on, and when (client mock-up, 2026-08-19).
//
// It answers the question a guard asks while a load is being unloaded in front
// of them — "is this the same consignment that left, on the same vehicle,
// against this pass?" — without opening the full record and losing the queue.
//
// THE MOCK'S "From Gate" IS DEPARTMENT, and its "Returned By" is the person the
// pass names as carrying the material. There is no gate entity in this schema
// and no separate returner field; the same rule the record view follows applies
// — a row this app cannot fill is given the fact it does have, never an em dash.
import React from 'react';
import type { GatePassView } from '../../types';
import { formatCurrency } from '../../lib/formatCurrency';
import { formatDateTime } from '../../lib/formatDate';

const Glyphs = {
  building: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.75 20.25V5.25h9v15M13.75 20.25h5.5V10.5h-5.5" />
      <path strokeLinecap="round" d="M7.5 8.75h3.5M7.5 12h3.5M7.5 15.25h3.5" />
    </svg>
  ),
  truck: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.75 7.25h10.5v9H2.75zM13.25 10.25h3.75L21.25 14v2.25h-8z" />
      <circle cx="7" cy="18" r="1.75" />
      <circle cx="17" cy="18" r="1.75" />
    </svg>
  ),
  purpose: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.75h7.5L19 8.25V20.25H7z" />
      <path strokeLinecap="round" d="M14.5 3.75V8.25H19M9.75 12.75h4.5M9.75 15.75h4.5" />
    </svg>
  ),
  person: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path strokeLinecap="round" d="M4.75 19.5a7.25 7.25 0 0114.5 0" />
    </svg>
  ),
  rupee: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 4.75h9M7.5 8.75h9M7.5 12.75h4a4 4 0 000-8M7.5 12.75l7 6.5" />
    </svg>
  ),
  clock: (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" />
      <path strokeLinecap="round" d="M12 7.75V12l2.75 1.75" />
    </svg>
  ),
} as const;

function Meta({
  glyph,
  label,
  value,
}: {
  glyph: keyof typeof Glyphs;
  label: string;
  value: string;
}): React.ReactElement {
  return (
    <div className="gb-meta-row">
      {Glyphs[glyph]}
      <span className="min-w-0">
        <span className="gb-meta-label">{label}</span>
        <span className="gb-meta-value">{value}</span>
      </span>
    </div>
  );
}

export default function ReturnRowMeta({ pass }: { pass: GatePassView }): React.ReactElement {
  return (
    <div className="gb-detail-box">
      <div className="gb-meta">
        <Meta glyph="building" label="Department" value={pass.department_name} />
        <Meta glyph="truck" label="Vehicle No." value={pass.vehicle_number || 'Not stated'} />
        <Meta glyph="purpose" label="Purpose" value={pass.purpose || 'Not stated'} />
        {/* THE PASS'S TOTAL, over the lines listed beside it (client,
          * 2026-08-21). `v_gate_passes.total_value`, never re-summed from the
          * rows on screen — a return panel that priced a pass differently from
          * its own record would be two answers to one question. */}
        <Meta
          glyph="rupee"
          label="Total Value"
          value={pass.total_value > 0 ? formatCurrency(pass.total_value) : 'Not priced'}
        />
        <Meta glyph="person" label="Authorised By" value={pass.raised_by_name} />
        <Meta glyph="person" label="Carried By" value={pass.visitor_name} />
        <Meta glyph="clock" label="Created On" value={formatDateTime(pass.created_at)} />
      </div>
    </div>
  );
}
