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
import { isToday } from 'date-fns';
import type { GatePassView } from '../types';
import PassField from './PassField';
import { parseCompanyInfo } from '../lib/companyInfo';
import { formatDateOnly, formatDateTime, formatTime } from '../lib/formatDate';

/** One moment in the "Raised → Mismatch → Override" timeline. */
function TimelineItem({ label, at }: { label: string; at: string | null }): React.ReactElement | null {
  if (!at) return null;
  const shown = isToday(new Date(at)) ? formatTime(at) : formatDateOnly(at);
  return (
    <span className="inline-flex items-center gap-1 text-caption text-navy-500 whitespace-nowrap">
      <span className="w-1 h-1 rounded-full bg-navy-300" />
      <span className="uppercase tracking-wider text-navy-500 text-[10px] font-semibold">{label}</span>
      {shown}
    </span>
  );
}

type Props = {
  pass: GatePassView;
  /** Tighter grid + row gaps for the HOD dashboard's compact drill cards.
   *  The guard's cards stay roomy — they are read one-handed at a barrier. */
  dense?: boolean;
  /** The HOD board hides this: the HOD raised the pass, so their own name
   *  back at them is noise (client feedback, 2026-08-11). The admin board
   *  oversees every department and keeps it. */
  showRaisedBy?: boolean;
};

export default function PassRowBody({
  pass: p,
  dense = false,
  showRaisedBy = true,
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
        <PassField label="Visitor" value={p.visitor_name || '—'} />
        {showRaisedBy && <PassField label="Raised By" value={p.raised_by_name || '—'} emphasize />}
        <PassField label="Material" value={p.material_summary ?? '—'} />
        <PassField label="Items" value={`${p.item_count} item${p.item_count !== 1 ? 's' : ''}`} />
        <PassField label="Vehicle" value={p.vehicle_number || '—'} />
        <PassField label="Department" value={p.department_name || '—'} />
        <PassField label="Raised At" value={formatDateTime(p.created_at)} />
        {/* RGP only — an NRGP never comes back, so a blank/"—" field here
            would read as missing data rather than "not applicable". */}
        {isRgp && p.expected_return_date && (
          <PassField label="Expected Return" value={formatDateOnly(p.expected_return_date)} emphasize />
        )}
        {p.verified_by_name && <PassField label="Verified By" value={p.verified_by_name} />}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <TimelineItem label="Raised" at={p.created_at} />
        <TimelineItem label="Mismatch" at={p.flag_reason ? (p.flagged_at ?? p.verified_at) : null} />
        <TimelineItem
          label="Override"
          at={p.status === 'hod_reviewed' ? (p.hod_reviewed_at ?? p.verified_at) : null}
        />
      </div>

      {p.flag_reason && (
        <div className="flex items-start gap-2 text-caption text-flagged-600 font-medium">
          <span className="w-1 h-1 rounded-full bg-flagged-500 shrink-0 mt-1.5" />
          <span>{p.flag_reason}</span>
        </div>
      )}
    </div>
  );
}
