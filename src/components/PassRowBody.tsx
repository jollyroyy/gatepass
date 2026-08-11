// The drill card's CardContent — every fact PassRow's identity-only header
// deliberately omits, each rendered EXACTLY ONCE. Client feedback 2026-08-10:
// the old GuardDrillCard showed vendor/vehicle/department in the header AND
// again in its own detail grid; this is the single place those facts live now.
//
// Layout follows DRILL_CARD_SPEC.md Rule 2: a horizontal strip of labelled
// columns on md+ (`grid-cols-2 md:grid-cols-4 lg:grid-cols-5`), collapsing to
// stacked label/value pairs below md. Four facts are emphasised (heavier
// weight only, never colour) per the client's follow-up: vendor, who raised
// it, and — RGP only — the expected return date. Item value is deliberately
// NOT here: `GatePassView` carries no pass-level total, only per-item
// `approx_value` on `GatePassItemView`, which this component never fetches
// (presentation only, no new queries). See PassDetail / VerifyItemsTable,
// which already have the item rows loaded, for where that figure IS shown.
import React from 'react';
import type { GatePassView } from '../types';
import PassField from './PassField';
import PassTimelineStrip from './PassTimelineStrip';
import { parseCompanyInfo } from '../lib/companyInfo';
import { formatDateOnly, formatDateTime } from '../lib/formatDate';

type Props = {
  pass: GatePassView;
  /** Tighter grid + row gaps for the HOD dashboard's compact drill cards.
   *  The guard's cards stay roomy — they are read one-handed at a barrier. */
  dense?: boolean;
  /** The HOD board hides this: the HOD raised the pass, so their own name
   *  back at them is noise (client feedback, 2026-08-11). The admin board
   *  oversees every department and keeps it. */
  showRaisedBy?: boolean;
  /** The trimmed fact set, for My Passes: "like the card format of the
   *  dashboard but with a little less information" (client, 2026-08-11).
   *  Drops Visitor, Department, Raised At and Verified By — an HOD reading
   *  their OWN register already knows the department and who raised it, and
   *  the raise time is in the timeline directly below. What survives is what
   *  they actually scan for: vendor, what went out, on which vehicle, and when
   *  it is due back. */
  slim?: boolean;
};

export default function PassRowBody({
  pass: p,
  dense = false,
  showRaisedBy = true,
  slim = false,
}: Props): React.ReactElement {
  const company = parseCompanyInfo(p.visitor_company);
  const isRgp = p.type === 'RGP';

  return (
    <div className={`flex flex-col ${dense ? 'gap-2.5' : 'gap-4'}`}>
      {/* Stacked label/value pairs below md (375px is the guard's phone at the
          barrier — nothing here may force horizontal scroll), a horizontal
          strip of aligned columns from md up. */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 ${
          dense ? 'lg:grid-cols-6 gap-x-3 gap-y-2.5' : 'lg:grid-cols-5 gap-x-4 gap-y-4'
        }`}
      >
        <PassField label="Vendor" value={company.name || '—'} emphasize />
        {!slim && <PassField label="Visitor" value={p.visitor_name || '—'} />}
        {!slim && showRaisedBy && (
          <PassField label="Raised By" value={p.raised_by_name || '—'} emphasize />
        )}
        <PassField label="Material" value={p.material_summary ?? '—'} />
        <PassField label="Items" value={`${p.item_count} item${p.item_count !== 1 ? 's' : ''}`} />
        <PassField label="Vehicle" value={p.vehicle_number || '—'} />
        {!slim && <PassField label="Department" value={p.department_name || '—'} />}
        {!slim && <PassField label="Raised At" value={formatDateTime(p.created_at)} />}
        {/* RGP only — an NRGP never comes back, so a blank/"—" field here
            would read as missing data rather than "not applicable". */}
        {isRgp && p.expected_return_date && (
          <PassField label="Expected Return" value={formatDateOnly(p.expected_return_date)} emphasize />
        )}
        {!slim && p.verified_by_name && <PassField label="Verified By" value={p.verified_by_name} />}
      </div>

      {/* Raised → Mismatch → Override → Cleared Out → Returned. The card's
          badge names only the LATEST state now, so this is where a reader
          finds that the pass was matched on the way out. */}
      <PassTimelineStrip pass={p} />

      {p.flag_reason && (
        <div className="flex items-start gap-2 text-caption text-flagged-600 font-medium">
          <span className="w-1 h-1 rounded-full bg-flagged-500 shrink-0 mt-1.5" />
          <span>{p.flag_reason}</span>
        </div>
      )}
    </div>
  );
}
